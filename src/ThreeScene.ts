import * as THREE from 'three'
import { MapControls } from 'three/addons/controls/MapControls.js'
import { TransformControls } from 'three/addons/controls/TransformControls.js'
import type { SceneState, ThreeSceneOptions, CubeTransform } from './types'
import * as config from './threeConfig'
import { SceneHierarchyManager } from './scene/SceneHierarchyManager'
import { SceneSelectionManager } from './scene/SceneSelectionManager'

export class ThreeScene {
  private container: HTMLElement
  private state: SceneState
  private onStateChange?: (state: SceneState) => void
  private onTransformModeChange?: (mode: 'translate' | 'rotate' | 'scale' | null) => void
  private onSelectionChange?: (hasSelection: boolean) => void
  private onSelectionInfoChange?: (info: { selectedCount: number; hasGroupSelected: boolean; canGroup: boolean; canUngroup: boolean }) => void

  private hierarchyManager: SceneHierarchyManager
  private selectionManager: SceneSelectionManager

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
  private keydownHandler?: (e: KeyboardEvent) => void
  private keyupHandler?: (e: KeyboardEvent) => void

  private pointerDownPos: { x: number; y: number } | null = null
  private transformMode: 'translate' | 'rotate' | 'scale' | null = 'translate'
  private lastTransformMode: 'translate' | 'rotate' | 'scale' = 'translate'
  private resizeObserver: ResizeObserver | null = null
  private resizeAnimationFrameId: number | null = null

  constructor(options: ThreeSceneOptions) {
    this.container = options.container
    this.onStateChange = options.onStateChange
    this.onTransformModeChange = options.onTransformModeChange
    this.onSelectionChange = options.onSelectionChange
    this.onSelectionInfoChange = options.onSelectionInfoChange

    this.hierarchyManager = new SceneHierarchyManager()
    this.selectionManager = new SceneSelectionManager()

    this.state = {
      type: 'cube_scene',
      num_assets: options.initialState?.num_assets ?? 1,
      asset_transforms: options.initialState?.asset_transforms ?? [],
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
    this.camera.position.set(0, 4, 8)
    this.camera.lookAt(0, 0, 0)

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    this.renderer.setSize(width, height, false)
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    this.container.appendChild(this.renderer.domElement)

    const canvas = this.renderer.domElement
    canvas.style.position = 'absolute'
    canvas.style.top = '0'
    canvas.style.left = '0'
    canvas.style.width = '100%'
    canvas.style.height = '100%'
    canvas.style.cursor = 'grab'

    // Lighting
    const ambientLight = new THREE.AmbientLight(config.AMBIENT_LIGHT_COLOR, config.AMBIENT_LIGHT_INTENSITY)
    this.scene.add(ambientLight)

    const mainLight = new THREE.DirectionalLight(config.MAIN_LIGHT_COLOR, config.MAIN_LIGHT_INTENSITY)
    mainLight.position.copy(config.MAIN_LIGHT_OFFSET)
    mainLight.castShadow = true
    mainLight.shadow.mapSize.width = config.SHADOW_MAP_WIDTH
    mainLight.shadow.mapSize.height = config.SHADOW_MAP_HEIGHT
    mainLight.shadow.bias = config.SHADOW_BIAS
    mainLight.shadow.normalBias = config.SHADOW_NORMAL_BIAS
    
    const d = config.SHADOW_FRUSTUM_SIZE
    mainLight.shadow.camera.left = -d
    mainLight.shadow.camera.right = d
    mainLight.shadow.camera.top = d
    mainLight.shadow.camera.bottom = -d
    mainLight.shadow.camera.near = 0.1
    mainLight.shadow.camera.far = 100
    this.scene.add(mainLight)

    const fillLight = new THREE.DirectionalLight(config.FILL_LIGHT_COLOR, config.FILL_LIGHT_INTENSITY)
    fillLight.position.copy(config.FILL_LIGHT_POSITION)
    this.scene.add(fillLight)

    // Floor Grid
    const gridHelper = new THREE.GridHelper(
      config.GRID_SIZE,
      config.GRID_DIVISIONS,
      config.GRID_COLOR_CENTER,
      config.GRID_COLOR_GRID
    )
    gridHelper.position.y = -1.0
    this.scene.add(gridHelper)

    // Floor plane
    const floorGeo = new THREE.PlaneGeometry(100, 100)
    const floorMat = new THREE.MeshStandardMaterial({ color: 0xdbdbdb, roughness: 1, metalness: 0 })
    const floorMesh = new THREE.Mesh(floorGeo, floorMat)
    floorMesh.name = 'floor'
    floorMesh.rotation.x = -Math.PI / 2
    floorMesh.position.y = -1.002
    floorMesh.receiveShadow = true
    this.scene.add(floorMesh)

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

  private updateMesh(): void {
    this.hierarchyManager.updateMesh(
      this.scene,
      this.state,
      () => this.selectionManager.clearSelectionUI(this.scene, this.transformControls),
      this.transformControls.getHelper()
    )
    this.syncStateAndNotify()
  }

  private syncStateAndNotify(): void {
    this.hierarchyManager.syncState(
      this.scene,
      this.state,
      this.transformControls.getHelper(),
      this.selectionManager.getMultiSelectionPivot(),
      this.onStateChange
    )
  }

  private updateSelectionUI(): void {
    this.selectionManager.updateSelectionUI(
      this.scene,
      this.transformControls,
      this.transformMode,
      this.lastTransformMode,
      {
        onSelectionChange: this.onSelectionChange,
        onSelectionInfoChange: this.onSelectionInfoChange,
      }
    )
  }

  public groupSelected(): void {
    const selectedObjects = this.selectionManager.getSelectedObjects()
    const group = this.hierarchyManager.groupSelected(this.scene, selectedObjects)
    if (group) {
      this.selectionManager.setSelectedObjects([group])
      this.updateSelectionUI()
      this.syncStateAndNotify()
    }
  }

  public ungroupSelected(): void {
    const selectedObjects = this.selectionManager.getSelectedObjects()
    const newSelected = this.hierarchyManager.ungroupSelected(this.scene, selectedObjects)
    this.selectionManager.setSelectedObjects(newSelected)
    this.updateSelectionUI()
    this.syncStateAndNotify()
  }

  public addNewAsset(): void {
    if (!this.state.asset_transforms) {
      this.state.asset_transforms = []
    }

    const px = Math.random() * 4 - 2
    const pz = Math.random() * 4 - 2
    const py = 0.0

    const rand1 = Math.random()
    const rand2 = Math.random()
    const sx = 0.6 + rand1 * 0.4
    const sz = 0.6 + rand2 * 0.4
    const sy = 1.0 + rand1 * 1.5

    const newTransform: CubeTransform = { px, py, pz, rx: 0, ry: 0, rz: 0, sx, sy, sz }
    const newMesh = this.hierarchyManager.createBlockMesh(newTransform)
    this.scene.add(newMesh)
    this.hierarchyManager.registerMesh(newMesh)

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
      this.scene.remove(obj)
      if (obj.type === 'Mesh') {
        const mesh = obj as THREE.Mesh
        this.hierarchyManager.unregisterMesh(mesh)
        mesh.geometry.dispose()
      } else if (obj.type === 'Group') {
        obj.traverse(child => {
          if ((child as THREE.Mesh).isMesh) {
            const m = child as THREE.Mesh
            this.hierarchyManager.unregisterMesh(m)
            m.geometry.dispose()
          }
        })
      }
    })

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
        if (visibleGizmoIntersects.length > 0 && (activeAxis !== null || visibleGizmoIntersects.some(h => ['X','Y','Z','XY','YZ','XZ','E','R','S','XYZE'].includes(h.object.name)))) {
          return
        }
      }

      // Collect selectable objects
      const selectableObjects: THREE.Object3D[] = []
      this.scene.children.forEach(child => {
        if (child.name !== 'floor' &&
            child.type !== 'AmbientLight' &&
            child.type !== 'DirectionalLight' &&
            child.type !== 'GridHelper' &&
            child !== this.transformControls.getHelper()) {
          selectableObjects.push(child)
        }
      })

      const intersects = raycaster.intersectObjects(selectableObjects, true)

      if (intersects.length > 0) {
        const clickedMesh = intersects[0].object
        const topObj = this.selectionManager.getTopSelectableObject(clickedMesh, this.scene, this.transformControls.getHelper())

        if (topObj) {
          const selectedObjects = this.selectionManager.getSelectedObjects()
          if (event.shiftKey) {
            const existingIdx = selectedObjects.indexOf(topObj)
            if (existingIdx !== -1) {
              selectedObjects.splice(existingIdx, 1)
            } else {
              selectedObjects.push(topObj)
            }
          } else {
            this.selectionManager.setSelectedObjects([topObj])
          }
          const modeToUse = this.transformMode ?? this.lastTransformMode
          if (!this.transformMode) {
            this.setTransformMode(modeToUse)
            if (this.onTransformModeChange) {
              this.onTransformModeChange(modeToUse)
            }
          }
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

    this.keydownHandler = (event: KeyboardEvent) => {
      if (event.key === 'Shift') {
        this.enableSnapping()
      }
      const isCmdOrCtrl = event.metaKey || event.ctrlKey
      if (isCmdOrCtrl && !event.shiftKey && event.key.toLowerCase() === 'g') {
        event.preventDefault()
        event.stopPropagation()
        event.stopImmediatePropagation()
        this.groupSelected()
      } else if (isCmdOrCtrl && event.shiftKey && event.key.toLowerCase() === 'g') {
        event.preventDefault()
        event.stopPropagation()
        event.stopImmediatePropagation()
        this.ungroupSelected()
      } else if (event.key === 'Delete' || event.key === 'Backspace') {
        const activeEl = document.activeElement
        if (!activeEl || activeEl.tagName === 'BODY' || this.container.contains(activeEl)) {
          event.preventDefault()
          event.stopPropagation()
          event.stopImmediatePropagation()
          this.deleteSelectedAsset()
        }
      }
    }

    this.keyupHandler = (event: KeyboardEvent) => {
      if (event.key === 'Shift') {
        this.disableSnapping()
      }
    }

    this.renderer.domElement.addEventListener('pointerdown', this.pointerDownHandler)
    this.renderer.domElement.addEventListener('pointerup', this.pointerUpHandler)
    window.addEventListener('pointerdown', this.windowPointerDownHandler)
    window.addEventListener('keydown', this.keydownHandler, { capture: true })
    window.addEventListener('keyup', this.keyupHandler, { capture: true })

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
      this.controls.update()
    }
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
    } else if (newState.asset_transforms !== undefined) {
      this.state.asset_transforms = newState.asset_transforms
      this.updateMesh()
    }
    if (newState.num_assets !== undefined && newState.num_assets !== this.state.num_assets) {
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
    if (this.keydownHandler) {
      window.removeEventListener('keydown', this.keydownHandler, { capture: true })
    }
    if (this.keyupHandler) {
      window.removeEventListener('keyup', this.keyupHandler, { capture: true })
    }

    if (this.controls) {
      this.controls.dispose()
    }

    if (this.transformControls) {
      this.transformControls.dispose()
    }

    this.renderer.dispose()
    this.scene.clear()
  }

  public getScene(): THREE.Scene {
    return this.scene
  }

  public getTransformHelper(): THREE.Object3D {
    return this.transformControls.getHelper()
  }
}
