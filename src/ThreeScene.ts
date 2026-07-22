import * as THREE from 'three'
import { MapControls } from 'three/addons/controls/MapControls.js'
import { TransformControls } from 'three/addons/controls/TransformControls.js'
import type { SceneState, ThreeSceneOptions, CubeTransform } from './types'

export class ThreeScene {
  private container: HTMLElement
  private state: SceneState
  private onStateChange?: (state: SceneState) => void

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
  private transformMode: 'translate' | 'rotate' | 'scale' = 'translate'

  constructor(options: ThreeSceneOptions) {
    this.container = options.container
    this.onStateChange = options.onStateChange
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
    const bgColor = new THREE.Color(0xd3d3d7)
    this.scene.background = bgColor
    this.scene.fog = new THREE.Fog(bgColor, 1, 30)

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
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6)
    this.scene.add(ambientLight)

    const mainLight = new THREE.DirectionalLight(0xffffff, 0.8)
    mainLight.position.set(5, 10, 5)
    mainLight.castShadow = true
    mainLight.shadow.mapSize.width = 1024
    mainLight.shadow.mapSize.height = 1024
    mainLight.shadow.bias = -0.0005
    this.scene.add(mainLight)

    const fillLight = new THREE.DirectionalLight(0x3d4974, 0.3)
    fillLight.position.set(-5, 3, -5)
    this.scene.add(fillLight)

    // Floor Grid (50x50m) matching ComfyUI-3D-motion-reference
    const gridHelper = new THREE.GridHelper(50, 50, 0xaaaaaf, 0xc5c5cb)
    gridHelper.position.y = -1.0
    this.scene.add(gridHelper)

    // Floor plane that receives shadows
    const floorGeo = new THREE.PlaneGeometry(50, 50)
    const floorMat = new THREE.MeshStandardMaterial({
      color: 0xd3d3d7,
      roughness: 1,
      metalness: 0,
    })
    const floorMesh = new THREE.Mesh(floorGeo, floorMat)
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

    // Align transforms list with num_assets
    if (this.state.asset_transforms.length !== this.state.num_assets) {
      const newTransforms: CubeTransform[] = []
      for (let i = 0; i < this.state.num_assets; i++) {
        if (this.state.asset_transforms[i]) {
          newTransforms.push(this.state.asset_transforms[i])
        } else {
          let x = 0
          let z = 0
          let height = 2.0
          let rotationY = 0
          if (i > 0) {
            const seed1 = Math.sin(i * 12.9898) * 43758.5453
            const seed2 = Math.sin(i * 78.233) * 43758.5453
            const rand1 = seed1 - Math.floor(seed1)
            const rand2 = seed2 - Math.floor(seed2)
            x = (rand1 - 0.5) * 6.0
            z = (rand2 - 0.5) * 6.0
            height = 1.0 + (rand1 * 2.0)
            rotationY = rand1 * 0.5 - 0.25
          }
          newTransforms.push({
            px: x,
            py: -1.0 + height / 2,
            pz: z,
            rx: 0,
            ry: rotationY,
            rz: 0,
            sx: 1,
            sy: 1,
            sz: 1
          })
        }
      }
      this.state.asset_transforms = newTransforms
      if (this.onStateChange) {
        this.onStateChange({ ...this.state })
      }
    }

    for (let i = 0; i < this.state.num_assets; i++) {
      const t = this.state.asset_transforms[i]
      let width = 0.8
      let depth = 0.8
      let height = 2.0

      if (i > 0) {
        const seed1 = Math.sin(i * 12.9898) * 43758.5453
        const seed2 = Math.sin(i * 78.233) * 43758.5453
        const rand1 = seed1 - Math.floor(seed1)
        const rand2 = seed2 - Math.floor(seed2)
        width = 0.6 + rand1 * 0.4
        depth = 0.6 + rand2 * 0.4
        height = 1.0 + rand1 * 1.5
      }

      const geometry = new THREE.BoxGeometry(width, height, depth)
      const mesh = new THREE.Mesh(geometry, materials)

      mesh.position.set(t.px, t.py, t.pz)
      mesh.rotation.set(t.rx, t.ry, t.rz)
      mesh.scale.set(t.sx, t.sy, t.sz)
      mesh.castShadow = true
      mesh.receiveShadow = true

      this.scene.add(mesh)
      this.meshes.push(mesh)
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

      const rect = this.renderer.domElement.getBoundingClientRect()
      mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
      mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1

      raycaster.setFromCamera(mouse, this.camera)
      const intersects = raycaster.intersectObjects(this.meshes)

      if (intersects.length > 0) {
        const clickedMesh = intersects[0].object
        this.transformControls.attach(clickedMesh)
      } else {
        const gizmoIntersects = raycaster.intersectObjects(this.transformControls.getHelper().children, true)
        if (gizmoIntersects.length === 0) {
          this.transformControls.detach()
        }
      }
    }

    this.renderer.domElement.addEventListener('pointerdown', this.pointerDownHandler)

    const resizeObserver = new ResizeObserver(() => {
      this.onResize()
    })
    resizeObserver.observe(this.container)
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

  public setTransformMode(mode: 'translate' | 'rotate' | 'scale'): void {
    this.transformMode = mode
    if (this.transformControls) {
      this.transformControls.setMode(mode)
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

    if (this.onStateChange) {
      this.onStateChange({ ...this.state })
    }
  }

  public dispose(): void {
    if (this.animationId !== null) {
      cancelAnimationFrame(this.animationId)
      this.animationId = null
    }

    if (this.globalWheelHandler) {
      window.removeEventListener('wheel', this.globalWheelHandler, { capture: true })
    }

    if (this.pointerDownHandler) {
      this.renderer.domElement.removeEventListener('pointerdown', this.pointerDownHandler)
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
}
