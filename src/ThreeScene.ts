import * as THREE from 'three'
import { MapControls } from 'three/addons/controls/MapControls.js'
import type { SceneState, ThreeSceneOptions } from './types'

export class ThreeScene {
  private container: HTMLElement
  private state: SceneState
  private onStateChange?: (state: SceneState) => void

  private scene!: THREE.Scene
  private camera!: THREE.PerspectiveCamera
  private renderer!: THREE.WebGLRenderer
  private cubeMesh: THREE.Mesh | null = null
  private gridHelper: THREE.GridHelper | null = null
  private animationId: number | null = null
  private controls!: MapControls
  private isHovered = false
  private globalWheelHandler?: (e: WheelEvent) => void

  constructor(options: ThreeSceneOptions) {
    this.container = options.container
    this.onStateChange = options.onStateChange
    this.state = {
      type: 'cube_scene',
      cube_size: options.initialState?.cube_size ?? 1.0,
      color: options.initialState?.color ?? '#4a90e2',
      grid_visible: options.initialState?.grid_visible ?? true,
    }

    this.initThreeJS()
    this.bindEvents()
    this.animate()
  }

  private initThreeJS(): void {
    const width = this.container.clientWidth || 300
    const height = this.container.clientHeight || 300

    this.scene = new THREE.Scene()
    this.scene.background = new THREE.Color(0x0f141d)

    this.camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 100)
    this.camera.position.set(0, 3, 6)
    this.camera.lookAt(0, 0, 0)

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    this.renderer.setSize(width, height, false)
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.container.appendChild(this.renderer.domElement)

    const canvas = this.renderer.domElement
    canvas.style.position = 'absolute'
    canvas.style.top = '0'
    canvas.style.left = '0'
    canvas.style.width = '100%'
    canvas.style.height = '100%'
    canvas.style.cursor = 'grab'

    // Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.5)
    this.scene.add(ambientLight)

    const mainLight = new THREE.DirectionalLight(0xffffff, 0.9)
    mainLight.position.set(5, 12, 7)
    this.scene.add(mainLight)

    const rimLight = new THREE.DirectionalLight(0x4a90e2, 0.5)
    rimLight.position.set(-5, 4, -5)
    this.scene.add(rimLight)

    // Floor Grid
    this.gridHelper = new THREE.GridHelper(12, 24, 0x4a90e2, 0x223344)
    this.gridHelper.position.y = 0
    this.gridHelper.visible = this.state.grid_visible
    this.scene.add(this.gridHelper)

    // 3D Cube
    const geometry = new THREE.BoxGeometry(1, 1, 1)
    const material = new THREE.MeshStandardMaterial({
      color: new THREE.Color(this.state.color),
      roughness: 0.3,
      metalness: 0.4,
    })

    this.cubeMesh = new THREE.Mesh(geometry, material)
    this.updateCubeTransform()
    this.scene.add(this.cubeMesh)

    // Controls
    this.controls = new MapControls(this.camera, this.renderer.domElement)
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.05
    this.controls.minDistance = 1.5
    this.controls.maxDistance = 20.0
    this.controls.maxPolarAngle = Math.PI / 2 - 0.02
  }

  private updateCubeTransform(): void {
    if (!this.cubeMesh) return
    const size = this.state.cube_size
    this.cubeMesh.scale.set(size, size, size)
    this.cubeMesh.position.y = size / 2
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

  public setState(newState: Partial<SceneState>): void {
    if (newState.cube_size !== undefined && newState.cube_size !== this.state.cube_size) {
      this.state.cube_size = newState.cube_size
      this.updateCubeTransform()
    }
    if (newState.color !== undefined && newState.color !== this.state.color) {
      this.state.color = newState.color
      if (this.cubeMesh && (this.cubeMesh.material as THREE.MeshStandardMaterial)) {
        ;(this.cubeMesh.material as THREE.MeshStandardMaterial).color.set(this.state.color)
      }
    }
    if (newState.grid_visible !== undefined && newState.grid_visible !== this.state.grid_visible) {
      this.state.grid_visible = newState.grid_visible
      if (this.gridHelper) {
        this.gridHelper.visible = this.state.grid_visible
      }
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

    if (this.controls) {
      this.controls.dispose()
    }

    this.renderer.dispose()
    this.scene.clear()
  }
}
