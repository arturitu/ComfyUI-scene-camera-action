import * as THREE from 'three'
import { MapControls } from 'three/addons/controls/MapControls.js'
import { TransformControls } from 'three/addons/controls/TransformControls.js'
import type { SceneState, ThreeSceneOptions, CubeTransform } from './types'
import * as config from './threeConfig'

export class ThreeScene {
  private container: HTMLElement
  private state: SceneState
  private onStateChange?: (state: SceneState) => void
  private onTransformModeChange?: (mode: 'translate' | 'rotate' | 'scale' | null) => void
  private onSelectionChange?: (hasSelection: boolean) => void

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
  private pointerDownPos: { x: number; y: number } | null = null
  private selectedMesh: THREE.Mesh | null = null
  private transformMode: 'translate' | 'rotate' | 'scale' | null = 'translate'
  private lastTransformMode: 'translate' | 'rotate' | 'scale' = 'translate'
  private resizeObserver: ResizeObserver | null = null
  private resizeAnimationFrameId: number | null = null

  constructor(options: ThreeSceneOptions) {
    this.container = options.container
    this.onStateChange = options.onStateChange
    this.onTransformModeChange = options.onTransformModeChange
    this.onSelectionChange = options.onSelectionChange
    this.state = {
      type: 'cube_scene',
      num_assets: options.initialState?.num_assets ?? 1,
      asset_transforms: options.initialState?.asset_transforms ?? [],
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

    // Floor Grid matching ComfyUI-3D-motion-reference
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
    })

    this.transformControls.addEventListener('objectChange', () => {
      const target = this.transformControls.object
      if (target) {
        const index = this.meshes.indexOf(target as THREE.Mesh)
        if (index !== -1 && this.state.asset_transforms) {
          const t = this.state.asset_transforms[index]
          if (t) {
            t.px = target.position.x
            t.py = target.position.y
            t.pz = target.position.z
            t.rx = target.rotation.x
            t.ry = target.rotation.y
            t.rz = target.rotation.z
            t.sx = target.scale.x
            t.sy = target.scale.y
            t.sz = target.scale.z

            if (this.onStateChange) {
              this.onStateChange({ ...this.state })
            }
          }
        }
      }
    })

    this.scene.add(this.transformControls.getHelper())

    // Create the meshes
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

  private updateMesh(): void {
    if (this.transformControls) {
      this.transformControls.detach()
    }

    this.meshes.forEach((mesh) => {
      this.scene.remove(mesh)
      mesh.geometry.dispose()
      if (Array.isArray(mesh.material)) {
        mesh.material.forEach((m) => m.dispose())
      } else {
        mesh.material.dispose()
      }
    })
    this.meshes = []

    // Side: 0xbfbfbf, Top: 0xe6e6e6, Front: 0x3d4974 (blueish)
    const frontMat = new THREE.MeshStandardMaterial({ color: 0x3d4974, roughness: 0.4, metalness: 0.1 })
    const topMat = new THREE.MeshStandardMaterial({ color: 0xe6e6e6, roughness: 0.4, metalness: 0.1 })
    const sideMat = new THREE.MeshStandardMaterial({ color: 0xbfbfbf, roughness: 0.4, metalness: 0.1 })
    const materials = [sideMat, sideMat, topMat, sideMat, frontMat, sideMat]

    if (!this.state.asset_transforms) {
      this.state.asset_transforms = []
    }



    // Migrate old scale 1x1x1 configurations to their calculated dimensions so they don't jump sizes when shifted
    this.state.asset_transforms.forEach((t, i) => {
      if (t.sx === 1.0 && t.sy === 1.0 && t.sz === 1.0) {
        if (i === 0) {
          t.sx = 0.8
          t.sz = 0.8
          t.sy = 2.0
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
    })

    this.state.num_assets = this.state.asset_transforms.length

    this.state.asset_transforms.forEach((t) => {
      // Always create a 1x1x1 box and let the scale represent its true dimensions
      const geometry = new THREE.BoxGeometry(1, 1, 1)
      const mesh = new THREE.Mesh(geometry, materials)

      mesh.position.set(t.px, t.py, t.pz)
      mesh.rotation.set(t.rx, t.ry, t.rz)
      mesh.scale.set(t.sx, t.sy, t.sz)
      mesh.castShadow = true
      mesh.receiveShadow = true

      this.scene.add(mesh)
      this.meshes.push(mesh)
    })
  }

  public addNewAsset(): void {
    if (!this.state.asset_transforms) {
      this.state.asset_transforms = []
    }

    // Spawn with random offset from center
    const px = (Math.random() * 4 - 2)
    const pz = (Math.random() * 4 - 2)
    const py = 0.0 // box center Y (spawns on floor)

    // Randomize dimensions directly into scale
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

    this.state.asset_transforms.push(newTransform)
    this.state.num_assets = this.state.asset_transforms.length

    this.updateMesh()

    // Select the new asset automatically
    const newMesh = this.meshes[this.meshes.length - 1]
    if (newMesh) {
      const modeToUse = this.transformMode ?? this.lastTransformMode
      if (!this.transformMode) {
        this.setTransformMode(modeToUse)
        if (this.onTransformModeChange) {
          this.onTransformModeChange(modeToUse)
        }
      }
      this.selectedMesh = newMesh
      this.transformControls.attach(newMesh)
      if (this.onSelectionChange) {
        this.onSelectionChange(true)
      }
    }

    if (this.onStateChange) {
      this.onStateChange({ ...this.state })
    }
  }

  public deleteSelectedAsset(): void {
    if (!this.transformControls.object) return
    const selectedMesh = this.transformControls.object as THREE.Mesh
    const index = this.meshes.indexOf(selectedMesh)
    if (index !== -1) {
      if (!this.state.asset_transforms) {
        this.state.asset_transforms = []
      }
      this.state.asset_transforms.splice(index, 1)
      this.state.num_assets = this.state.asset_transforms.length

      this.selectedMesh = null
      this.transformControls.detach()
      if (this.onSelectionChange) {
        this.onSelectionChange(false)
      }
      this.updateMesh()

      // Select previous asset if there is one
      const prevIndex = index - 1
      if (prevIndex >= 0 && this.meshes[prevIndex]) {
        const prevMesh = this.meshes[prevIndex]
        const modeToUse = this.transformMode ?? this.lastTransformMode
        if (!this.transformMode) {
          this.setTransformMode(modeToUse)
          if (this.onTransformModeChange) {
            this.onTransformModeChange(modeToUse)
          }
        }
        this.selectedMesh = prevMesh
        this.transformControls.attach(prevMesh)
        if (this.onSelectionChange) {
          this.onSelectionChange(true)
        }
      }

      if (this.onStateChange) {
        this.onStateChange({ ...this.state })
      }
    }
  }

  public duplicateSelectedAsset(): void {
    if (!this.transformControls.object) return
    const selectedMesh = this.transformControls.object as THREE.Mesh
    const index = this.meshes.indexOf(selectedMesh)
    if (index === -1 || !this.state.asset_transforms) return

    const srcTransform = this.state.asset_transforms[index]
    if (!srcTransform) return

    // Clone transform with a small position offset so the duplicate doesn't overlap
    const dupTransform: CubeTransform = {
      px: srcTransform.px + 0.8,
      py: srcTransform.py,
      pz: srcTransform.pz + 0.8,
      rx: srcTransform.rx,
      ry: srcTransform.ry,
      rz: srcTransform.rz,
      sx: srcTransform.sx,
      sy: srcTransform.sy,
      sz: srcTransform.sz,
    }

    this.state.asset_transforms.push(dupTransform)
    this.state.num_assets = this.state.asset_transforms.length

    this.updateMesh()

    // Auto-select the duplicated asset
    const newMesh = this.meshes[this.meshes.length - 1]
    if (newMesh) {
      const modeToUse = this.transformMode ?? this.lastTransformMode
      if (!this.transformMode) {
        this.setTransformMode(modeToUse)
        if (this.onTransformModeChange) {
          this.onTransformModeChange(modeToUse)
        }
      }
      this.selectedMesh = newMesh
      this.transformControls.attach(newMesh)
      if (this.onSelectionChange) {
        this.onSelectionChange(true)
      }
    }

    if (this.onStateChange) {
      this.onStateChange({ ...this.state })
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
      if (event.button !== 0) return // Left clicks only
      this.pointerDownPos = { x: event.clientX, y: event.clientY }
    }

    this.pointerUpHandler = (event: PointerEvent) => {
      if (event.button !== 0 || !this.pointerDownPos) return // Left clicks only

      const dx = event.clientX - this.pointerDownPos.x
      const dy = event.clientY - this.pointerDownPos.y
      this.pointerDownPos = null

      const dist = Math.hypot(dx, dy)

      // If pointer moved more than 15px, user was dragging/orbiting camera, not clicking
      if (dist > 15) return

      const rect = this.renderer.domElement.getBoundingClientRect()
      mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
      mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1

      raycaster.setFromCamera(mouse, this.camera)

      // Check gizmo intersection FIRST — if the user clicked on visible gizmo handles,
      // keep current selection and do not switch or deselect assets
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
          return // User clicked on a visible gizmo handle
        }
      }

      const intersects = raycaster.intersectObjects(this.meshes)

      if (intersects.length > 0) {
        const clickedMesh = intersects[0].object as THREE.Mesh
        const modeToUse = this.transformMode ?? this.lastTransformMode
        this.selectedMesh = clickedMesh
        if (!this.transformMode) {
          this.setTransformMode(modeToUse)
          if (this.onTransformModeChange) {
            this.onTransformModeChange(modeToUse)
          }
        } else {
          this.transformControls.attach(clickedMesh)
        }
        if (this.onSelectionChange) {
          this.onSelectionChange(true)
        }
      } else {
        // Clicked empty space — deselect
        this.selectedMesh = null
        this.transformControls.detach()
        if (this.onSelectionChange) {
          this.onSelectionChange(false)
        }
      }
    }

    this.windowPointerDownHandler = (event: PointerEvent) => {
      if (event.button !== 0) return
      // If clicking outside container and an asset is selected, deselect it
      if (this.container && !this.container.contains(event.target as Node)) {
        if (this.transformControls && this.transformControls.object) {
          this.selectedMesh = null
          this.transformControls.detach()
          if (this.onSelectionChange) {
            this.onSelectionChange(false)
          }
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
      this.controls.update()
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
        if (this.selectedMesh) {
          this.transformControls.attach(this.selectedMesh)
          if (this.onSelectionChange) {
            this.onSelectionChange(true)
          }
        }
      } else {
        this.transformControls.detach()
      }
    }
  }

  public setState(newState: Partial<SceneState>): void {
    if (newState.num_assets !== undefined && newState.num_assets !== this.state.num_assets) {
      this.state.num_assets = newState.num_assets
      this.updateMesh()
    }
    if (newState.asset_transforms !== undefined) {
      this.state.asset_transforms = newState.asset_transforms
      this.updateMesh()
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
