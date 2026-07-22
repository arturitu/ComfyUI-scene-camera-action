import * as THREE from 'three'
import { MapControls } from 'three/addons/controls/MapControls.js'
import type { ActingState, SceneState, ThreeActingOptions } from './types'

export class ThreeActing {
  private container: HTMLElement
  private state: ActingState
  private onStateChange?: (state: ActingState) => void

  private scene!: THREE.Scene
  private camera!: THREE.PerspectiveCamera
  private renderer!: THREE.WebGLRenderer
  private environmentMesh: THREE.Mesh | null = null
  private characterGroup: THREE.Group | null = null
  private gridHelper: THREE.GridHelper | null = null
  private animationId: number | null = null
  private controls!: MapControls
  private isHovered = false
  private globalWheelHandler?: (e: WheelEvent) => void

  // Character movement control state
  private keysPressed: Record<string, boolean> = {}
  private characterPosition = new THREE.Vector3(0, 0, 2)
  private characterRotation = 0
  private keydownHandler?: (e: KeyboardEvent) => void
  private keyupHandler?: (e: KeyboardEvent) => void

  constructor(options: ThreeActingOptions) {
    this.container = options.container
    this.onStateChange = options.onStateChange
    this.state = {
      character_speed: options.initialState?.character_speed ?? 1.0,
      scene_data: options.initialState?.scene_data ?? {
        type: 'cube_scene',
        cube_size: 1.0,
        color: '#4a90e2',
        grid_visible: true,
      },
    }

    this.initThreeJS()
    this.bindEvents()
    this.animate()
  }

  private initThreeJS(): void {
    const width = this.container.clientWidth || 300
    const height = this.container.clientHeight || 300

    this.scene = new THREE.Scene()
    this.scene.background = new THREE.Color(0x141019)

    this.camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 100)
    this.camera.position.set(0, 4, 7)
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
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6)
    this.scene.add(ambientLight)

    const mainLight = new THREE.DirectionalLight(0xffffff, 0.8)
    mainLight.position.set(6, 12, 6)
    this.scene.add(mainLight)

    const characterLight = new THREE.PointLight(0xff007f, 1.2, 8)
    characterLight.position.set(0, 2, 2)
    this.scene.add(characterLight)

    // Floor Grid
    this.gridHelper = new THREE.GridHelper(12, 24, 0xff007f, 0x332233)
    this.gridHelper.position.y = 0
    this.scene.add(this.gridHelper)

    // Build connected scene environment & character
    this.buildSceneEnvironment()
    this.buildCharacter()

    // Controls
    this.controls = new MapControls(this.camera, this.renderer.domElement)
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.05
    this.controls.minDistance = 1.5
    this.controls.maxDistance = 20.0
    this.controls.maxPolarAngle = Math.PI / 2 - 0.02
  }

  private buildSceneEnvironment(): void {
    if (this.environmentMesh) {
      this.scene.remove(this.environmentMesh)
      this.environmentMesh.geometry.dispose()
      if (Array.isArray(this.environmentMesh.material)) {
        this.environmentMesh.material.forEach((m) => m.dispose())
      } else {
        this.environmentMesh.material.dispose()
      }
      this.environmentMesh = null
    }

    const sceneData = this.state.scene_data || {}
    const size = sceneData.cube_size ?? 1.0
    const color = sceneData.color ?? '#4a90e2'

    if (this.gridHelper) {
      this.gridHelper.visible = sceneData.grid_visible ?? true
    }

    const geometry = new THREE.BoxGeometry(1, 1, 1)
    const material = new THREE.MeshStandardMaterial({
      color: new THREE.Color(color),
      roughness: 0.3,
      metalness: 0.4,
    })

    this.environmentMesh = new THREE.Mesh(geometry, material)
    this.environmentMesh.scale.set(size, size, size)
    this.environmentMesh.position.set(0, size / 2, 0)
    this.scene.add(this.environmentMesh)
  }

  private buildCharacter(): void {
    if (this.characterGroup) {
      this.scene.remove(this.characterGroup)
    }

    this.characterGroup = new THREE.Group()

    // Character body (Capsule/Cylinder)
    const bodyGeo = new THREE.CapsuleGeometry(0.3, 0.6, 8, 16)
    const bodyMat = new THREE.MeshStandardMaterial({
      color: 0xff007f,
      roughness: 0.2,
      metalness: 0.5,
    })
    const bodyMesh = new THREE.Mesh(bodyGeo, bodyMat)
    bodyMesh.position.y = 0.6
    this.characterGroup.add(bodyMesh)

    // Character head sphere
    const headGeo = new THREE.SphereGeometry(0.22, 16, 16)
    const headMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.1 })
    const headMesh = new THREE.Mesh(headGeo, headMat)
    headMesh.position.y = 1.15
    this.characterGroup.add(headMesh)

    // Character direction arrow / visor
    const visorGeo = new THREE.ConeGeometry(0.12, 0.3, 8)
    visorGeo.rotateX(Math.PI / 2)
    const visorMat = new THREE.MeshStandardMaterial({ color: 0x00ffff, emissive: 0x00ffff, emissiveIntensity: 0.5 })
    const visorMesh = new THREE.Mesh(visorGeo, visorMat)
    visorMesh.position.set(0, 1.15, 0.25)
    this.characterGroup.add(visorMesh)

    this.characterGroup.position.copy(this.characterPosition)
    this.scene.add(this.characterGroup)
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

    // Keyboard listeners when mouse is hovered over canvas
    this.keydownHandler = (e: KeyboardEvent) => {
      if (!this.isHovered) return
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyW', 'KeyS', 'KeyA', 'KeyD'].includes(e.code)) {
        e.preventDefault()
        this.keysPressed[e.code] = true
      }
    }

    this.keyupHandler = (e: KeyboardEvent) => {
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyW', 'KeyS', 'KeyA', 'KeyD'].includes(e.code)) {
        this.keysPressed[e.code] = false
      }
    }

    window.addEventListener('keydown', this.keydownHandler)
    window.addEventListener('keyup', this.keyupHandler)

    const resizeObserver = new ResizeObserver(() => {
      this.onResize()
    })
    resizeObserver.observe(this.container)
  }

  private updateCharacterMovement(): void {
    if (!this.characterGroup) return

    const speed = 0.05 * this.state.character_speed
    let moveZ = 0
    let moveX = 0

    if (this.keysPressed['KeyW'] || this.keysPressed['ArrowUp']) moveZ -= 1
    if (this.keysPressed['KeyS'] || this.keysPressed['ArrowDown']) moveZ += 1
    if (this.keysPressed['KeyA'] || this.keysPressed['ArrowLeft']) moveX -= 1
    if (this.keysPressed['KeyD'] || this.keysPressed['ArrowRight']) moveX += 1

    if (moveX !== 0 || moveZ !== 0) {
      const dir = new THREE.Vector3(moveX, 0, moveZ).normalize()
      this.characterPosition.addScaledVector(dir, speed)
      this.characterGroup.position.copy(this.characterPosition)

      const targetAngle = Math.atan2(dir.x, dir.z)
      this.characterGroup.rotation.y = targetAngle
    }
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
    this.updateCharacterMovement()
    if (this.controls) {
      this.controls.update()
    }
    this.renderer.render(this.scene, this.camera)
  }

  public setSceneData(sceneData: SceneState): void {
    this.state.scene_data = { ...sceneData }
    this.buildSceneEnvironment()
  }

  public setState(newState: Partial<ActingState>): void {
    if (newState.character_speed !== undefined) {
      this.state.character_speed = newState.character_speed
    }
    if (newState.scene_data !== undefined) {
      this.state.scene_data = { ...newState.scene_data }
      this.buildSceneEnvironment()
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
    if (this.keydownHandler) {
      window.removeEventListener('keydown', this.keydownHandler)
    }
    if (this.keyupHandler) {
      window.removeEventListener('keyup', this.keyupHandler)
    }

    if (this.controls) {
      this.controls.dispose()
    }

    this.renderer.dispose()
    this.scene.clear()
  }
}
