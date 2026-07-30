import * as THREE from 'three'
import { MapControls } from 'three/addons/controls/MapControls.js'
import { TransformControls } from 'three/addons/controls/TransformControls.js'
import type { SceneState, ThreeSceneOptions, CubeTransform, SceneNode, SceneBlockNode, SceneGroupNode } from './types'
import * as config from './threeConfig'

export class ThreeScene {
  private container: HTMLElement
  private state: SceneState
  private onStateChange?: (state: SceneState) => void
  private onTransformModeChange?: (mode: 'translate' | 'rotate' | 'scale' | null) => void
  private onSelectionChange?: (hasSelection: boolean) => void
  private onSelectionInfoChange?: (info: { selectedCount: number; hasGroupSelected: boolean; canGroup: boolean; canUngroup: boolean }) => void

  private scene!: THREE.Scene
  private camera!: THREE.PerspectiveCamera
  private renderer!: THREE.WebGLRenderer
  private meshes: THREE.Mesh[] = []
  private animationId: number | null = null
  private controls!: MapControls
  private transformControls!: TransformControls
  private isHovered = false

  private globalWheelHandler?: (e: WheelEvent) => void
  private pointerDownHandler?: (e: PointerEvent) => void
  private pointerUpHandler?: (e: PointerEvent) => void
  private windowPointerDownHandler?: (e: PointerEvent) => void
  private keydownHandler?: (e: KeyboardEvent) => void

  private pointerDownPos: { x: number; y: number } | null = null
  private selectedObjects: THREE.Object3D[] = []
  private boxHelpers: THREE.BoxHelper[] = []
  private multiSelectionPivot: THREE.Group | null = null
  private startPivotTransform: { pos: THREE.Vector3; quat: THREE.Quaternion; scale: THREE.Vector3 } | null = null
  private startObjectTransforms: Map<THREE.Object3D, { pos: THREE.Vector3; quat: THREE.Quaternion; scale: THREE.Vector3 }> = new Map()

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

    this.camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 100)
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

    // Floor plane that receives shadows
    const floorGeo = new THREE.PlaneGeometry(100, 100)
    const floorMat = new THREE.MeshStandardMaterial({
      color: 0xdbdbdb,
      roughness: 1,
      metalness: 0,
    })
    const floorMesh = new THREE.Mesh(floorGeo, floorMat)
    floorMesh.name = 'floor'
    floorMesh.rotation.x = -Math.PI / 2
    floorMesh.position.y = -1.002
    floorMesh.receiveShadow = true
    this.scene.add(floorMesh)

    // Setup TransformControls
    this.transformControls = new TransformControls(this.camera, this.renderer.domElement)
    this.transformControls.size = 2.0
    this.transformControls.addEventListener('change', () => this.renderer.render(this.scene, this.camera))
    this.transformControls.addEventListener('dragging-changed', (event: any) => {
      this.controls.enabled = !event.value

      if (event.value) {
        // Dragging started: capture initial transforms if multi-selecting
        if (this.selectedObjects.length >= 2 && this.multiSelectionPivot) {
          this.startPivotTransform = {
            pos: this.multiSelectionPivot.position.clone(),
            quat: this.multiSelectionPivot.quaternion.clone(),
            scale: this.multiSelectionPivot.scale.clone(),
          }
          this.startObjectTransforms.clear()
          this.selectedObjects.forEach((obj) => {
            this.startObjectTransforms.set(obj, {
              pos: obj.position.clone(),
              quat: obj.quaternion.clone(),
              scale: obj.scale.clone(),
            })
          })
        }
      } else {
        // Dragging ended: re-center multiSelectionPivot on new centroid
        if (this.selectedObjects.length >= 2 && this.multiSelectionPivot) {
          const bbox = new THREE.Box3()
          this.selectedObjects.forEach((obj) => bbox.expandByObject(obj))
          const newCenter = new THREE.Vector3()
          bbox.getCenter(newCenter)

          this.multiSelectionPivot.position.copy(newCenter)
          this.multiSelectionPivot.quaternion.identity()
          this.multiSelectionPivot.scale.set(1, 1, 1)
          this.multiSelectionPivot.updateMatrixWorld()
        }
        this.startPivotTransform = null
        this.startObjectTransforms.clear()
      }
    })

    this.transformControls.addEventListener('objectChange', () => {
      if (this.selectedObjects.length >= 2 && this.multiSelectionPivot && this.startPivotTransform) {
        const p = this.multiSelectionPivot.position
        const q = this.multiSelectionPivot.quaternion
        const s = this.multiSelectionPivot.scale

        const p0 = this.startPivotTransform.pos
        const q0 = this.startPivotTransform.quat
        const s0 = this.startPivotTransform.scale

        const qDelta = q.clone().multiply(q0.clone().invert())
        const sDelta = new THREE.Vector3(s.x / s0.x, s.y / s0.y, s.z / s0.z)
        const pDelta = p.clone().sub(p0)

        this.selectedObjects.forEach((obj) => {
          const init = this.startObjectTransforms.get(obj)
          if (!init) return

          const vecRel = init.pos.clone().sub(p0)
          vecRel.multiply(sDelta)
          vecRel.applyQuaternion(qDelta)

          obj.position.copy(p0).add(pDelta).add(vecRel)
          obj.quaternion.copy(qDelta).multiply(init.quat)
          obj.scale.copy(init.scale).multiply(sDelta)
          obj.updateMatrixWorld(true)
        })
      }

      if (this.boxHelpers.length > 0) {
        this.boxHelpers.forEach((h) => h.update())
      }
      this.syncStateAndNotify()
    })

    this.scene.add(this.transformControls.getHelper())

    // Create the meshes & groups from state
    this.updateMesh()

    // Initialize MapControls
    this.controls = new MapControls(this.camera, this.renderer.domElement)
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.05
    this.controls.screenSpacePanning = false
    this.controls.minDistance = 1.5
    this.controls.maxDistance = 20.0
    this.controls.maxPolarAngle = Math.PI / 2 - 0.05
    this.controls.zoomToCursor = true
  }

  private createBlockMesh(transform: CubeTransform): THREE.Mesh {
    const frontMat = new THREE.MeshStandardMaterial({ color: 0x3d4974, roughness: 0.4, metalness: 0.1 })
    const topMat = new THREE.MeshStandardMaterial({ color: 0xe6e6e6, roughness: 0.4, metalness: 0.1 })
    const sideMat = new THREE.MeshStandardMaterial({ color: 0xbfbfbf, roughness: 0.4, metalness: 0.1 })
    const materials = [sideMat, sideMat, topMat, sideMat, frontMat, sideMat]

    const geometry = new THREE.BoxGeometry(1, 1, 1)
    const mesh = new THREE.Mesh(geometry, materials)

    mesh.position.set(transform.px, transform.py, transform.pz)
    mesh.rotation.set(transform.rx, transform.ry, transform.rz)
    mesh.scale.set(transform.sx, transform.sy, transform.sz)
    mesh.castShadow = true
    mesh.receiveShadow = true

    return mesh
  }

  private buildNodeFromData(nodeData: SceneNode): THREE.Object3D {
    if (nodeData.type === 'block') {
      const mesh = this.createBlockMesh(nodeData.transform)
      mesh.uuid = nodeData.id || mesh.uuid
      if (nodeData.name) mesh.name = nodeData.name
      this.meshes.push(mesh)
      return mesh
    } else {
      const group = new THREE.Group()
      group.uuid = nodeData.id || group.uuid
      if (nodeData.name) group.name = nodeData.name
      group.position.set(nodeData.transform.px, nodeData.transform.py, nodeData.transform.pz)
      group.rotation.set(nodeData.transform.rx, nodeData.transform.ry, nodeData.transform.rz)
      group.scale.set(nodeData.transform.sx, nodeData.transform.sy, nodeData.transform.sz)

      if (nodeData.children && nodeData.children.length > 0) {
        nodeData.children.forEach(childNode => {
          const childObj = this.buildNodeFromData(childNode)
          group.add(childObj)
        })
      }
      return group
    }
  }

  private updateMesh(): void {
    this.clearSelectionUI()
    if (this.transformControls) {
      this.transformControls.detach()
    }

    // Remove existing user objects from scene
    const objectsToRemove: THREE.Object3D[] = []
    this.scene.children.forEach(child => {
      if (child.name !== 'floor' &&
          child.type !== 'AmbientLight' &&
          child.type !== 'DirectionalLight' &&
          child.type !== 'GridHelper' &&
          child !== this.transformControls.getHelper()) {
        objectsToRemove.push(child)
      }
    })
    objectsToRemove.forEach(obj => this.scene.remove(obj))
    this.meshes = []

    // Build scene from hierarchical nodes if present
    if (this.state.nodes && this.state.nodes.length > 0) {
      this.state.nodes.forEach(nodeData => {
        const obj = this.buildNodeFromData(nodeData)
        this.scene.add(obj)
      })
    } else {
      // Fallback: build from legacy asset_transforms array
      if (!this.state.asset_transforms) {
        this.state.asset_transforms = []
      }
      this.state.asset_transforms.forEach((t, i) => {
        if (t.sx === 1.0 && t.sy === 1.0 && t.sz === 1.0) {
          if (i === 0) {
            t.sx = 0.8; t.sz = 0.8; t.sy = 2.0
          } else {
            const seed1 = Math.sin(i * 12.9898) * 43758.5453
            const seed2 = Math.sin(i * 78.233) * 43758.5453
            const rand1 = seed1 - Math.floor(seed1)
            const rand2 = seed2 - Math.floor(seed2)
            t.sx = 0.6 + rand1 * 0.4
            t.sz = 0.6 + rand2 * 0.4
            t.sy = 1.0 + rand1 * 1.5
          }
        }
        const mesh = this.createBlockMesh(t)
        this.scene.add(mesh)
        this.meshes.push(mesh)
      })
    }

    this.syncStateAndNotify()
  }

  private serializeObjectToNode(obj: THREE.Object3D): SceneNode | null {
    if (obj.type === 'Mesh' && obj.name !== 'floor') {
      const mesh = obj as THREE.Mesh
      return {
        id: mesh.uuid,
        type: 'block',
        name: mesh.name || 'Block',
        transform: {
          px: mesh.position.x, py: mesh.position.y, pz: mesh.position.z,
          rx: mesh.rotation.x, ry: mesh.rotation.y, rz: mesh.rotation.z,
          sx: mesh.scale.x, sy: mesh.scale.y, sz: mesh.scale.z
        }
      }
    } else if (obj.type === 'Group' && obj !== this.transformControls.getHelper()) {
      const group = obj as THREE.Group
      const childrenNodes: SceneNode[] = []
      group.children.forEach(child => {
        const node = this.serializeObjectToNode(child)
        if (node) childrenNodes.push(node)
      })
      return {
        id: group.uuid,
        type: 'group',
        name: group.name || 'Group',
        transform: {
          px: group.position.x, py: group.position.y, pz: group.position.z,
          rx: group.rotation.x, ry: group.rotation.y, rz: group.rotation.z,
          sx: group.scale.x, sy: group.scale.y, sz: group.scale.z
        },
        children: childrenNodes
      }
    }
    return null
  }

  private countBlocks(node: SceneNode): number {
    if (node.type === 'block') return 1
    if (node.type === 'group' && node.children) {
      return node.children.reduce((sum, child) => sum + this.countBlocks(child), 0)
    }
    return 0
  }

  private syncStateAndNotify(): void {
    const nodes: SceneNode[] = []
    const legacyTransforms: CubeTransform[] = []

    this.scene.children.forEach(child => {
      const node = this.serializeObjectToNode(child)
      if (node) {
        nodes.push(node)
      }
    })

    // Populate legacy asset_transforms for backward compatibility
    this.meshes.forEach(mesh => {
      const worldPos = new THREE.Vector3()
      const worldQuat = new THREE.Quaternion()
      const worldScale = new THREE.Vector3()
      mesh.getWorldPosition(worldPos)
      mesh.getWorldQuaternion(worldQuat)
      mesh.getWorldScale(worldScale)
      const euler = new THREE.Euler().setFromQuaternion(worldQuat)

      legacyTransforms.push({
        px: worldPos.x, py: worldPos.y, pz: worldPos.z,
        rx: euler.x, ry: euler.y, rz: euler.z,
        sx: worldScale.x, sy: worldScale.y, sz: worldScale.z
      })
    })

    const totalBlocks = nodes.reduce((sum, n) => sum + this.countBlocks(n), 0)

    this.state.nodes = nodes
    this.state.asset_transforms = legacyTransforms
    this.state.num_assets = totalBlocks

    if (this.onStateChange) {
      this.onStateChange({ ...this.state })
    }
  }

  private clearSelectionUI(): void {
    this.boxHelpers.forEach(h => {
      this.scene.remove(h)
      h.dispose()
    })
    this.boxHelpers = []

    if (this.multiSelectionPivot) {
      this.scene.remove(this.multiSelectionPivot)
      this.multiSelectionPivot = null
    }

    if (this.transformControls) {
      this.transformControls.detach()
    }
    this.startPivotTransform = null
    this.startObjectTransforms.clear()
  }

  private updateSelectionUI(): void {
    this.clearSelectionUI()

    const count = this.selectedObjects.length
    const hasGroup = this.selectedObjects.some(o => o.type === 'Group')
    const canGroup = count >= 2
    const canUngroup = hasGroup

    if (count === 0) {
      if (this.onSelectionChange) this.onSelectionChange(false)
      if (this.onSelectionInfoChange) {
        this.onSelectionInfoChange({ selectedCount: 0, hasGroupSelected: false, canGroup: false, canUngroup: false })
      }
      return
    }

    const modeToUse = this.transformMode ?? this.lastTransformMode

    if (count === 1) {
      const target = this.selectedObjects[0]
      if (this.transformControls) {
        this.transformControls.setMode(modeToUse)
        this.transformControls.attach(target)
      }
      if (this.onSelectionChange) this.onSelectionChange(true)
      if (this.onSelectionInfoChange) {
        this.onSelectionInfoChange({ selectedCount: 1, hasGroupSelected: target.type === 'Group', canGroup: false, canUngroup: target.type === 'Group' })
      }
    } else {
      // Multi-selection (2+ items): show BoxHelpers and attach TransformControls to multiSelectionPivot
      this.selectedObjects.forEach(obj => {
        const helper = new THREE.BoxHelper(obj, 0x4a90e2)
        this.scene.add(helper)
        this.boxHelpers.push(helper)
      })

      const bbox = new THREE.Box3()
      this.selectedObjects.forEach(obj => bbox.expandByObject(obj))
      const centerVec = new THREE.Vector3()
      bbox.getCenter(centerVec)

      this.multiSelectionPivot = new THREE.Group()
      this.multiSelectionPivot.position.copy(centerVec)
      this.scene.add(this.multiSelectionPivot)

      if (this.transformControls) {
        this.transformControls.setMode(modeToUse)
        this.transformControls.attach(this.multiSelectionPivot)
      }

      if (this.onSelectionChange) this.onSelectionChange(true)
      if (this.onSelectionInfoChange) {
        this.onSelectionInfoChange({ selectedCount: count, hasGroupSelected: hasGroup, canGroup: true, canUngroup: canUngroup })
      }
    }
  }

  private getTopSelectableObject(obj: THREE.Object3D): THREE.Object3D | null {
    let curr: THREE.Object3D | null = obj
    while (curr && curr.parent && curr.parent !== this.scene) {
      if (curr.parent.type === 'Scene') break
      if (curr.parent.name === 'floor' || curr.parent === this.transformControls.getHelper()) break
      curr = curr.parent
    }
    if (curr && (curr.type === 'Mesh' || curr.type === 'Group') && curr.name !== 'floor') {
      return curr
    }
    return null
  }

  public groupSelected(): void {
    if (this.selectedObjects.length < 2) return

    // Calculate center
    const bbox = new THREE.Box3()
    this.selectedObjects.forEach(obj => bbox.expandByObject(obj))
    const centerVec = new THREE.Vector3()
    bbox.getCenter(centerVec)

    const group = new THREE.Group()
    group.name = 'Group_' + Math.random().toString(36).substring(2, 7)
    group.position.copy(centerVec)
    this.scene.add(group)

    this.selectedObjects.forEach(obj => group.attach(obj))

    this.selectedObjects = [group]
    this.updateSelectionUI()
    this.syncStateAndNotify()
  }

  public ungroupSelected(): void {
    const groups = this.selectedObjects.filter(o => o.type === 'Group')
    if (groups.length === 0) return

    const newSelected: THREE.Object3D[] = []

    this.selectedObjects.forEach(obj => {
      if (obj.type === 'Group') {
        const children = [...obj.children]
        children.forEach(child => {
          this.scene.attach(child)
          newSelected.push(child)
        })
        this.scene.remove(obj)
      } else {
        newSelected.push(obj)
      }
    })

    this.selectedObjects = newSelected
    this.updateSelectionUI()
    this.syncStateAndNotify()
  }

  public addNewAsset(): void {
    if (!this.state.asset_transforms) {
      this.state.asset_transforms = []
    }

    const px = (Math.random() * 4 - 2)
    const pz = (Math.random() * 4 - 2)
    const py = 0.0

    const rand1 = Math.random()
    const rand2 = Math.random()
    const sx = 0.6 + rand1 * 0.4
    const sz = 0.6 + rand2 * 0.4
    const sy = 1.0 + rand1 * 1.5

    const newTransform: CubeTransform = {
      px, py, pz,
      rx: 0, ry: 0, rz: 0,
      sx, sy, sz
    }

    const newMesh = this.createBlockMesh(newTransform)
    this.scene.add(newMesh)
    this.meshes.push(newMesh)

    this.selectedObjects = [newMesh]
    const modeToUse = this.transformMode ?? this.lastTransformMode
    this.setTransformMode(modeToUse)
    if (this.onTransformModeChange) {
      this.onTransformModeChange(modeToUse)
    }

    this.updateSelectionUI()
    this.syncStateAndNotify()
  }

  public deleteSelectedAsset(): void {
    if (this.selectedObjects.length === 0) return

    this.selectedObjects.forEach(obj => {
      this.scene.remove(obj)
      if (obj.type === 'Mesh') {
        const mesh = obj as THREE.Mesh
        const idx = this.meshes.indexOf(mesh)
        if (idx !== -1) this.meshes.splice(idx, 1)
        mesh.geometry.dispose()
      } else if (obj.type === 'Group') {
        obj.traverse(child => {
          if ((child as THREE.Mesh).isMesh) {
            const m = child as THREE.Mesh
            const idx = this.meshes.indexOf(m)
            if (idx !== -1) this.meshes.splice(idx, 1)
            m.geometry.dispose()
          }
        })
      }
    })

    this.selectedObjects = []
    this.updateSelectionUI()
    this.syncStateAndNotify()
  }

  public duplicateSelectedAsset(): void {
    if (this.selectedObjects.length === 0) return

    const newSelected: THREE.Object3D[] = []

    this.selectedObjects.forEach(obj => {
      const nodeData = this.serializeObjectToNode(obj)
      if (nodeData) {
        // Offset transform
        nodeData.transform.px += 0.8
        nodeData.transform.pz += 0.8
        nodeData.id = 'node_' + Math.random().toString(36).substring(2, 9)
        const dupObj = this.buildNodeFromData(nodeData)
        this.scene.add(dupObj)
        newSelected.push(dupObj)
      }
    })

    this.selectedObjects = newSelected
    this.updateSelectionUI()
    this.syncStateAndNotify()
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
      if (event.button !== 0) return // Left clicks only
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

      // Gizmo handle check
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

      // Collect all selectable user objects
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
        const topObj = this.getTopSelectableObject(clickedMesh)

        if (topObj) {
          if (event.shiftKey) {
            // Shift + Click multi-selection toggle
            const existingIdx = this.selectedObjects.indexOf(topObj)
            if (existingIdx !== -1) {
              this.selectedObjects.splice(existingIdx, 1)
            } else {
              this.selectedObjects.push(topObj)
            }
          } else {
            // Single selection
            this.selectedObjects = [topObj]
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
        // Clicked empty space — deselect
        this.selectedObjects = []
        this.updateSelectionUI()
      }
    }

    this.windowPointerDownHandler = (event: PointerEvent) => {
      if (event.button !== 0) return
      if (this.container && !this.container.contains(event.target as Node)) {
        if (this.selectedObjects.length > 0) {
          this.selectedObjects = []
          this.updateSelectionUI()
        }
      }
    }

    this.keydownHandler = (event: KeyboardEvent) => {
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

    this.renderer.domElement.addEventListener('pointerdown', this.pointerDownHandler)
    this.renderer.domElement.addEventListener('pointerup', this.pointerUpHandler)
    window.addEventListener('pointerdown', this.windowPointerDownHandler)
    window.addEventListener('keydown', this.keydownHandler, { capture: true })

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
    if (this.boxHelpers.length > 0) {
      this.boxHelpers.forEach(h => h.update())
    }
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
        if (this.selectedObjects.length > 0) {
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
