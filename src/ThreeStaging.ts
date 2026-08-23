import * as THREE from 'three'
import { MapControls } from 'three/addons/controls/MapControls.js'
import { TransformControls } from 'three/addons/controls/TransformControls.js'
import type { SceneState, ThreeStagingOptions, CubeTransform } from './types'
import * as config from './threeConfig'
import { StagingHierarchyManager } from './staging/StagingHierarchyManager'
import { StagingSelectionManager } from './staging/StagingSelectionManager'
import { StageEnvironment } from './staging/StageEnvironment'
import { InstancedStageMesh } from './staging/InstancedStageMesh'

const _tempCamDir = new THREE.Vector3()

export class ThreeStaging {
  private container: HTMLElement
  private state: SceneState
  private onStateChange?: (state: SceneState) => void
  private onTransformModeChange?: (mode: 'translate' | 'rotate' | 'scale' | null) => void
  private onSelectionChange?: (hasSelection: boolean) => void
  private onSelectionInfoChange?: (info: { selectedCount: number; hasGroupSelected: boolean; canGroup: boolean; canUngroup: boolean; cycleInfo?: { index: number; total: number } }) => void

  private hierarchyManager: StagingHierarchyManager
  private selectionManager: StagingSelectionManager
  private instancedStageMesh!: InstancedStageMesh
  private stagingRaycaster = new THREE.Raycaster()
  private stagingDitherOpacity = 1.0

  private scene!: THREE.Scene
  private camera!: THREE.PerspectiveCamera
  private renderer!: THREE.WebGLRenderer
  private animationId: number | null = null
  private controls!: MapControls
  private transformControls!: TransformControls
  private isHovered = false

  private globalWheelHandler?: (e: WheelEvent) => void
  private pointerDownHandler?: (e: PointerEvent) => void
  private pointerUpHandler?: (e: PointerEvent) => void
  private windowPointerDownHandler?: (e: PointerEvent) => void

  private pointerDownPos: { x: number; y: number } | null = null
  private transformMode: 'translate' | 'rotate' | 'scale' | null = 'translate'
  private lastTransformMode: 'translate' | 'rotate' | 'scale' = 'translate'
  private resizeObserver: ResizeObserver | null = null
  private resizeAnimationFrameId: number | null = null
  private cachedSceneExtent = 15.0

  constructor(options: ThreeStagingOptions) {
    this.container = options.container
    this.onStateChange = options.onStateChange
    this.onTransformModeChange = options.onTransformModeChange
    this.onSelectionChange = options.onSelectionChange
    this.onSelectionInfoChange = options.onSelectionInfoChange

    this.hierarchyManager = new StagingHierarchyManager()
    this.selectionManager = new StagingSelectionManager()

    this.state = {
      type: 'cube_stage',
      num_assets: options.initialState?.num_assets ?? 0,
      nodes: options.initialState?.nodes ?? [],
    }

    this.initThreeJS()
    this.bindEvents()
    this.animate()
  }

  private initThreeJS(): void {
    const width = this.container.clientWidth || 300
    const height = this.container.clientHeight || 300

    this.scene = new THREE.Scene()
    const bgColor = new THREE.Color(config.BACKGROUND_COLOR)
    this.scene.background = bgColor
    this.scene.fog = new THREE.Fog(bgColor, config.FOG_NEAR, config.FOG_FAR)

    this.camera = new THREE.PerspectiveCamera(config.CAMERA_FOV, width / height, config.CAMERA_NEAR, config.CAMERA_FAR)
    this.camera.position.set(-8, 4, 0)
    this.camera.lookAt(0, 0, 0)

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    this.renderer.setSize(width, height, false)
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    this.container.appendChild(this.renderer.domElement)

    const canvas = this.renderer.domElement
    canvas.tabIndex = 0
    canvas.style.outline = 'none'
    canvas.style.position = 'absolute'
    canvas.style.top = '0'
    canvas.style.left = '0'
    canvas.style.width = '100%'
    canvas.style.height = '100%'
    canvas.style.cursor = 'grab'

    canvas.addEventListener('mouseenter', () => { this.isHovered = true })
    canvas.addEventListener('mouseleave', () => { this.isHovered = false })
    canvas.addEventListener('webglcontextlost', (event: Event) => {
      event.preventDefault()
      if (this.animationId !== null) {
        cancelAnimationFrame(this.animationId)
        this.animationId = null
      }
    }, false)

    // Setup Stage Environment (Lights, Floor, Grid)
    const stageEnv = new StageEnvironment()
    stageEnv.initStage(this.scene)

    // Instanced Stage Mesh Container
    this.instancedStageMesh = new InstancedStageMesh()
    this.scene.add(this.instancedStageMesh.getGroup())

    // TransformControls
    this.transformControls = new TransformControls(this.camera, this.renderer.domElement)
    this.transformControls.size = 2.0
    this.transformControls.addEventListener('change', () => this.renderer.render(this.scene, this.camera))
    this.transformControls.addEventListener('dragging-changed', (event: any) => {
      this.controls.enabled = !event.value

      if (event.value && (window.event as KeyboardEvent)?.shiftKey) {
        this.enableSnapping()
      }

      this.selectionManager.onDraggingChanged(event.value)

      if (!event.value && !(window.event as KeyboardEvent)?.shiftKey) {
        this.disableSnapping()
      }
    })

    this.transformControls.addEventListener('objectChange', () => {
      this.selectionManager.onObjectChange()
      this.syncInstancedMesh()
      this.syncStateAndNotify()
    })

    this.scene.add(this.transformControls.getHelper())

    // Update scene mesh hierarchy from state
    this.updateMesh()

    // MapControls
    this.controls = new MapControls(this.camera, this.renderer.domElement)
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.05
    this.controls.screenSpacePanning = false
    this.controls.minDistance = config.CAMERA_MIN_DISTANCE
    this.controls.maxDistance = config.CAMERA_MAX_DISTANCE
    this.controls.maxPolarAngle = Math.PI / 2 - 0.05
    this.controls.zoomToCursor = true
  }

  private syncInstancedMesh(): void {
    const virtualBlocks = this.hierarchyManager.getAllVirtualBlocks(this.scene)
    this.instancedStageMesh.syncFromVirtualBlocks(virtualBlocks)
  }

  private updateMesh(): void {
    this.hierarchyManager.updateMesh(
      this.scene,
      this.state,
      () => this.selectionManager.clearSelectionUI(this.scene, this.transformControls),
      this.transformControls.getHelper(),
      this.instancedStageMesh
    )

    // Dynamically adjust fog and camera range based on overall scene extent
    const envObjects = this.hierarchyManager.getVirtualRootObjects(this.scene)
    this.cachedSceneExtent = config.calculateSceneExtent(envObjects)
    config.updateSceneFog(this.scene, this.camera, this.cachedSceneExtent, this.controls?.target)
    if (this.controls) {
      this.controls.maxDistance = Math.max(config.CAMERA_MAX_DISTANCE, this.cachedSceneExtent * 2.5)
    }

    this.syncStateAndNotify()
  }

  private syncStateAndNotify(): void {
    this.hierarchyManager.syncState(
      this.scene,
      this.state,
      this.transformControls.getHelper(),
      this.selectionManager.getMultiSelectionPivot(),
      undefined
    )
    if (this.onStateChange) {
      this.onStateChange({ ...this.state })
    }
  }

  private updateSelectionUI(cycleInfo?: { index: number; total: number }): void {
    this.selectionManager.updateSelectionUI(
      this.scene,
      this.transformControls,
      this.transformMode,
      this.lastTransformMode,
      {
        onSelectionChange: this.onSelectionChange,
        onSelectionInfoChange: this.onSelectionInfoChange,
      },
      cycleInfo
    )
  }

  public getSelectableCandidatesFromHits(instancedHits: THREE.Intersection[], otherHits: THREE.Intersection[]): THREE.Object3D[] {
    const candidates: THREE.Object3D[] = []
    const addCandidate = (obj: THREE.Object3D | null) => {
      if (obj && !candidates.includes(obj)) {
        candidates.push(obj)
      }
    }

    for (const hit of instancedHits) {
      if (hit.instanceId !== undefined && hit.instanceId !== null) {
        const virtualBlock = this.instancedStageMesh.getNodeByInstanceId(hit.instanceId)
        if (virtualBlock) {
          const topObj = this.selectionManager.getTopSelectableObject(virtualBlock, this.scene, this.transformControls.getHelper())
          if (topObj) {
            addCandidate(topObj)

            const chain: THREE.Object3D[] = []
            let curr: THREE.Object3D | null = virtualBlock
            while (curr && curr !== topObj) {
              if (curr.name !== '__edge_outline__' && curr.name !== '__box_helper__' && curr.name !== 'floor') {
                chain.unshift(curr)
              }
              curr = curr.parent
            }
            chain.forEach(c => addCandidate(c))
          }
        }
      }
    }

    for (const hit of otherHits) {
      let mesh: THREE.Object3D | null = hit.object
      if (!mesh || !mesh.visible) continue
      if (mesh.name === '__box_helper__' || mesh.name === 'floor' || mesh.name === 'grid' || mesh.name === 'helper') continue

      const topObj = this.selectionManager.getTopSelectableObject(mesh, this.scene, this.transformControls.getHelper())
      if (topObj) {
        addCandidate(topObj)
      }
    }

    return candidates
  }

  public groupSelected(): void {
    const selectedObjects = this.selectionManager.getSelectedObjects()
    const group = this.hierarchyManager.groupSelected(this.scene, selectedObjects)
    if (group) {
      this.syncInstancedMesh()
      this.selectionManager.setSelectedObjects([group])
      this.updateSelectionUI()
      this.syncStateAndNotify()
    }
  }

  public selectAll(): void {
    const topLevelObjects = this.hierarchyManager.getVirtualRootObjects(this.scene)
    this.selectionManager.setSelectedObjects(topLevelObjects)
    this.updateSelectionUI()
  }

  public ungroupSelected(): void {
    const selectedObjects = this.selectionManager.getSelectedObjects()
    const newSelected = this.hierarchyManager.ungroupSelected(this.scene, selectedObjects)
    this.syncInstancedMesh()
    this.selectionManager.setSelectedObjects(newSelected)
    this.updateSelectionUI()
    this.syncStateAndNotify()
  }

  public addNewAsset(): void {
    const px = Number((Math.random() * 4 - 2).toFixed(3))
    const pz = Number((Math.random() * 4 - 2).toFixed(3))

    const rand1 = Math.random()
    const rand2 = Math.random()
    const sx = Number((0.6 + rand1 * 0.4).toFixed(3))
    const sz = Number((0.6 + rand2 * 0.4).toFixed(3))
    const sy = Number((1.0 + rand1 * 1.5).toFixed(3))
    const py = Number((sy / 2.0).toFixed(3))

    const newTransform: CubeTransform = { px, py, pz, rx: 0, ry: 0, rz: 0, sx, sy, sz }
    const newMesh = this.hierarchyManager.createBlockMesh(newTransform)
    this.scene.add(newMesh)
    this.syncInstancedMesh()

    this.selectionManager.setSelectedObjects([newMesh])
    const modeToUse = this.transformMode ?? this.lastTransformMode
    this.setTransformMode(modeToUse)
    if (this.onTransformModeChange) {
      this.onTransformModeChange(modeToUse)
    }

    this.updateSelectionUI()
    this.syncStateAndNotify()
  }

  public deleteSelectedAsset(): void {
    const selectedObjects = this.selectionManager.getSelectedObjects()
    if (selectedObjects.length === 0) return

    selectedObjects.forEach(obj => {
      if (obj.parent) {
        obj.parent.remove(obj)
      } else {
        this.scene.remove(obj)
      }
    })

    this.syncInstancedMesh()
    this.selectionManager.setSelectedObjects([])
    this.updateSelectionUI()
    this.syncStateAndNotify()
  }

  public duplicateSelectedAsset(): void {
    const selectedObjects = this.selectionManager.getSelectedObjects()
    if (selectedObjects.length === 0) return

    const newSelected: THREE.Object3D[] = []

    selectedObjects.forEach(obj => {
      const nodeData = this.hierarchyManager.serializeObjectToNode(
        obj,
        this.transformControls.getHelper(),
        this.selectionManager.getMultiSelectionPivot()
      )
      if (nodeData) {
        nodeData.transform.px += 0.8
        nodeData.transform.pz += 0.8
        nodeData.id = 'node_' + Math.random().toString(36).substring(2, 9)
        const dupObj = this.hierarchyManager.buildNodeFromData(nodeData)
        this.scene.add(dupObj)
        newSelected.push(dupObj)
      }
    })

    this.syncInstancedMesh()
    this.selectionManager.setSelectedObjects(newSelected)
    this.updateSelectionUI()
    this.syncStateAndNotify()
  }

  private enableSnapping(): void {
    if (this.transformControls) {
      this.transformControls.setTranslationSnap(0.5)
      this.transformControls.setRotationSnap(THREE.MathUtils.degToRad(22.5))
      this.transformControls.setScaleSnap(0.5)
    }
  }

  private disableSnapping(): void {
    if (this.transformControls) {
      this.transformControls.setTranslationSnap(null)
      this.transformControls.setRotationSnap(null)
      this.transformControls.setScaleSnap(null)
    }
  }

  private bindEvents(): void {
    const canvas = this.renderer.domElement

    this.controls.addEventListener('start', () => {
      canvas.style.cursor = 'grabbing'
    })

    this.controls.addEventListener('end', () => {
      canvas.style.cursor = 'grab'
    })

    this.container.addEventListener('mouseenter', () => {
      this.isHovered = true
    })

    this.container.addEventListener('mouseleave', () => {
      this.isHovered = false
    })

    this.globalWheelHandler = (e: WheelEvent) => {
      if (!this.isHovered) return
      e.preventDefault()
      e.stopPropagation()
      e.stopImmediatePropagation()
      if (this.controls && typeof (this.controls as any)._handleMouseWheel === 'function') {
        (this.controls as any)._handleMouseWheel(e)
      }
    }

    window.addEventListener('wheel', this.globalWheelHandler, { capture: true, passive: false })

    const raycaster = new THREE.Raycaster()
    const mouse = new THREE.Vector2()

    this.pointerDownHandler = (event: PointerEvent) => {
      if (event.button !== 0) return
      this.pointerDownPos = { x: event.clientX, y: event.clientY }
    }

    this.pointerUpHandler = (event: PointerEvent) => {
      if (event.button !== 0 || !this.pointerDownPos) return

      const dx = event.clientX - this.pointerDownPos.x
      const dy = event.clientY - this.pointerDownPos.y
      this.pointerDownPos = null

      const dist = Math.hypot(dx, dy)
      if (dist > 15) return

      const rect = this.renderer.domElement.getBoundingClientRect()
      mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
      mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1

      raycaster.setFromCamera(mouse, this.camera)

      // Check gizmo hit
      if (this.transformControls.object) {
        const rawGizmoIntersects = raycaster.intersectObjects(
          this.transformControls.getHelper().children, true
        )
        const activeAxis = (this.transformControls as any).axis
        const visibleGizmoIntersects = rawGizmoIntersects.filter((hit) => {
          let curr: THREE.Object3D | null = hit.object
          while (curr && curr !== this.transformControls.getHelper()) {
            if (!curr.visible) return false
            curr = curr.parent
          }
          const name = hit.object.name
          return (name && name !== '' && name !== 'helper') || activeAxis !== null
        })
        if (visibleGizmoIntersects.length > 0 && (activeAxis !== null || visibleGizmoIntersects.some(h => ['X', 'Y', 'Z', 'XY', 'YZ', 'XZ', 'E', 'R', 'S', 'XYZE'].includes(h.object.name)))) {
          return
        }
      }

      // 1. Raycast against InstancedMesh
      const instancedIntersects = raycaster.intersectObject(this.instancedStageMesh.getSurfaceMesh(), false)

      // 2. Raycast against other non-block objects (e.g. spawn points)
      const otherSelectables: THREE.Object3D[] = []
      this.scene.children.forEach(child => {
        if (
          child.name === '__spawn_point_indicator__' ||
          child.name === '__spawn_point_mesh__'
        ) {
          otherSelectables.push(child)
        }
      })
      const otherIntersects = otherSelectables.length > 0 ? raycaster.intersectObjects(otherSelectables, true) : []

      if (instancedIntersects.length > 0 || otherIntersects.length > 0) {
        const candidates = this.getSelectableCandidatesFromHits(instancedIntersects, otherIntersects)

        if (candidates.length > 0) {
          const selectedObjects = this.selectionManager.getSelectedObjects()

          if (event.shiftKey) {
            const targetObj = candidates[0]
            const existingIdx = selectedObjects.indexOf(targetObj)
            if (existingIdx !== -1) {
              selectedObjects.splice(existingIdx, 1)
            } else {
              selectedObjects.push(targetObj)
            }
            this.selectionManager.setSelectedObjects(selectedObjects)
            this.updateSelectionUI()
          } else {
            let targetObj: THREE.Object3D = candidates[0]
            let targetIndex = 0

            if (selectedObjects.length === 1) {
              const currentSingle = selectedObjects[0]
              const currentIdx = candidates.indexOf(currentSingle)
              if (currentIdx !== -1) {
                targetIndex = (currentIdx + 1) % candidates.length
                targetObj = candidates[targetIndex]
              }
            }

            this.selectionManager.setSelectedObjects([targetObj])
            const modeToUse = this.transformMode ?? this.lastTransformMode
            if (!this.transformMode) {
              this.setTransformMode(modeToUse)
              if (this.onTransformModeChange) {
                this.onTransformModeChange(modeToUse)
              }
            }

            const cycleInfo = candidates.length > 1 ? { index: targetIndex + 1, total: candidates.length } : undefined
            this.updateSelectionUI(cycleInfo)
          }
        } else {
          this.selectionManager.setSelectedObjects([])
          this.updateSelectionUI()
        }
      } else {
        this.selectionManager.setSelectedObjects([])
        this.updateSelectionUI()
      }
    }

    this.windowPointerDownHandler = (event: PointerEvent) => {
      if (event.button !== 0) return
      if (this.container && !this.container.contains(event.target as Node)) {
        if (this.selectionManager.getSelectedObjects().length > 0) {
          this.selectionManager.setSelectedObjects([])
          this.updateSelectionUI()
        }
      }
    }

    this.renderer.domElement.addEventListener('pointerdown', this.pointerDownHandler)
    this.renderer.domElement.addEventListener('pointerup', this.pointerUpHandler)
    window.addEventListener('pointerdown', this.windowPointerDownHandler)

    this.resizeObserver = new ResizeObserver(() => {
      if (this.resizeAnimationFrameId !== null) {
        cancelAnimationFrame(this.resizeAnimationFrameId)
      }
      this.resizeAnimationFrameId = requestAnimationFrame(() => {
        this.onResize()
        this.resizeAnimationFrameId = null
      })
    })
    this.resizeObserver.observe(this.container)
  }

  private onResize(): void {
    const w = this.container.clientWidth
    const h = this.container.clientHeight
    if (w === 0 || h === 0) return

    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(w, h, false)
  }

  private animate(): void {
    this.animationId = requestAnimationFrame(() => this.animate())
    if (this.controls) {
      this.controls.target.x = Math.max(-config.MAX_PAN, Math.min(config.MAX_PAN, this.controls.target.x))
      this.controls.target.z = Math.max(-config.MAX_PAN, Math.min(config.MAX_PAN, this.controls.target.z))
      this.controls.update()
    }

    if (this.controls && this.instancedStageMesh) {
      const camPos = this.camera.position
      const targetPos = this.controls.target
      const distToTarget = camPos.distanceTo(targetPos)

      const occludedSet = new Set<number>()

      if (distToTarget > 0.05) {
        _tempCamDir.subVectors(targetPos, camPos).normalize()
        this.stagingRaycaster.set(camPos, _tempCamDir)
        this.stagingRaycaster.near = 0.05
        this.stagingRaycaster.far = Math.max(0.1, distToTarget - 0.25)

        const hits = this.stagingRaycaster.intersectObject(this.instancedStageMesh.getSurfaceMesh(), false)
        for (const hit of hits) {
          if (hit.distance < 1.25 && hit.instanceId !== undefined && hit.instanceId !== null) {
            occludedSet.add(hit.instanceId)
          }
        }
      }

      this.instancedStageMesh.setOccludedInstances(occludedSet, 0.2)
      this.instancedStageMesh.updateDither(0.016)
    }

    config.updateSceneFog(this.scene, this.camera, this.cachedSceneExtent, this.controls?.target)
    this.selectionManager.updateBoxHelpers()
    this.renderer.render(this.scene, this.camera)
  }

  public setTransformMode(mode: 'translate' | 'rotate' | 'scale' | null): void {
    this.transformMode = mode
    if (mode) {
      this.lastTransformMode = mode
    }
    if (this.transformControls) {
      if (mode) {
        this.transformControls.setMode(mode)
        this.transformControls.showX = true
        this.transformControls.showY = true
        this.transformControls.showZ = true
        if (this.selectionManager.getSelectedObjects().length > 0) {
          this.updateSelectionUI()
        }
      } else {
        this.transformControls.detach()
      }
    }
  }

  public setState(newState: Partial<SceneState>): void {
    if (newState.nodes !== undefined) {
      this.state.nodes = newState.nodes
      this.updateMesh()
    } else {
      this.state.nodes = []
      this.updateMesh()
    }
    if (newState.num_assets !== undefined) {
      this.state.num_assets = newState.num_assets
    }
  }

  public dispose(): void {
    if (this.animationId !== null) {
      cancelAnimationFrame(this.animationId)
      this.animationId = null
    }

    if (this.resizeAnimationFrameId !== null) {
      cancelAnimationFrame(this.resizeAnimationFrameId)
      this.resizeAnimationFrameId = null
    }

    if (this.resizeObserver) {
      this.resizeObserver.disconnect()
      this.resizeObserver = null
    }

    if (this.globalWheelHandler) {
      window.removeEventListener('wheel', this.globalWheelHandler, { capture: true })
    }

    if (this.pointerDownHandler) {
      this.renderer.domElement.removeEventListener('pointerdown', this.pointerDownHandler)
    }
    if (this.pointerUpHandler) {
      this.renderer.domElement.removeEventListener('pointerup', this.pointerUpHandler)
    }
    if (this.windowPointerDownHandler) {
      window.removeEventListener('pointerdown', this.windowPointerDownHandler)
    }

    if (this.controls) {
      this.controls.dispose()
    }

    if (this.transformControls) {
      this.transformControls.dispose()
    }

    if (this.instancedStageMesh) {
      this.instancedStageMesh.dispose()
    }

    if (this.hierarchyManager) {
      this.hierarchyManager.dispose()
    }

    if (this.renderer) {
      this.renderer.dispose()
      this.renderer.forceContextLoss()
      if (this.renderer.domElement && this.renderer.domElement.parentElement) {
        this.renderer.domElement.remove()
      }
    }
    this.scene.clear()
  }

  public getScene(): THREE.Scene {
    return this.scene
  }

  public getState(): SceneState {
    return this.state
  }

  public getTransformHelper(): THREE.Object3D {
    return this.transformControls.getHelper()
  }
}
