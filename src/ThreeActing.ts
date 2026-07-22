import * as THREE from 'three'
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js'
import { MeshBVH, MeshBVHHelper } from 'three-mesh-bvh'
import type { ActingState, ThreeActingOptions, CubeTransform, SceneState } from './types'

export class ThreeActing {
  private container: HTMLElement
  private state: ActingState
  private onStateChange?: (state: ActingState) => void

  private scene!: THREE.Scene
  private camera!: THREE.PerspectiveCamera
  private renderer!: THREE.WebGLRenderer
  private environmentMeshes: THREE.Mesh[] = []
  private characterGroup: THREE.Group | null = null
  private gridHelper: THREE.GridHelper | null = null
  private animationId: number | null = null
  private isHovered = false

  // BVH Collision data
  private colliderBVH: MeshBVH | null = null
  private bvhHelper: MeshBVHHelper | null = null
  private colliderVisualizer: THREE.Mesh | null = null
  private displayBVH = false
  private displayCollider = false

  // Character movement & physics control state
  private keysPressed: Record<string, boolean> = {}
  private characterPosition = new THREE.Vector3(0, -1.0, 2)
  private characterVelocity = new THREE.Vector3(0, 0, 0)
  private isOnGround = true
  private lastTime = performance.now()
  private keydownHandler?: (e: KeyboardEvent) => void
  private keyupHandler?: (e: KeyboardEvent) => void

  constructor(options: ThreeActingOptions) {
    this.container = options.container
    this.onStateChange = options.onStateChange
    this.state = {
      character_speed: options.initialState?.character_speed ?? 10.0,
      scene_data: options.initialState?.scene_data ?? null as any,
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
    this.scene.fog = new THREE.Fog(bgColor, 5, 20)

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

    // Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6)
    this.scene.add(ambientLight)

    const mainLight = new THREE.DirectionalLight(0xffffff, 0.8)
    mainLight.position.set(5, 10, 5)
    mainLight.castShadow = true
    mainLight.shadow.mapSize.width = 1024
    mainLight.shadow.mapSize.height = 1024
    this.scene.add(mainLight)

    const characterLight = new THREE.PointLight(0xff007f, 1.2, 8)
    characterLight.position.set(0, 2, 2)
    this.scene.add(characterLight)

    // Floor Grid (50x50m) matching ComfyUI-3D-motion-reference
    this.gridHelper = new THREE.GridHelper(50, 50, 0xaaaaaf, 0xc5c5cb)
    this.gridHelper.position.y = -1.0
    this.scene.add(this.gridHelper)

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

    // Build connected scene environment & character
    this.buildSceneEnvironment()
    this.buildCharacter()
  }

  private buildSceneEnvironment(): void {
    // Clean up old environment meshes
    this.environmentMeshes.forEach((mesh) => {
      this.scene.remove(mesh)
      mesh.geometry.dispose()
      if (Array.isArray(mesh.material)) {
        mesh.material.forEach((m) => m.dispose())
      } else {
        mesh.material.dispose()
      }
    })
    this.environmentMeshes = []

    // Clean up debug visualizations
    if (this.colliderVisualizer) {
      this.scene.remove(this.colliderVisualizer)
      this.colliderVisualizer.geometry.dispose()
      if (Array.isArray(this.colliderVisualizer.material)) {
        this.colliderVisualizer.material.forEach((m) => m.dispose())
      } else {
        this.colliderVisualizer.material.dispose()
      }
      this.colliderVisualizer = null
    }

    if (this.bvhHelper) {
      this.scene.remove(this.bvhHelper)
      this.bvhHelper = null
    }

    const sceneData = this.state.scene_data
    if (!sceneData || !sceneData.asset_transforms) {
      if (this.gridHelper) {
        this.gridHelper.visible = false
      }
      this.colliderBVH = null
      return
    }

    if (this.gridHelper) {
      this.gridHelper.visible = true
    }

    // Side: 0xbfbfbf, Top: 0xe6e6e6, Front: 0x3d4974 (blueish)
    const frontMat = new THREE.MeshStandardMaterial({ color: 0x3d4974, roughness: 0.4, metalness: 0.1 })
    const topMat = new THREE.MeshStandardMaterial({ color: 0xe6e6e6, roughness: 0.4, metalness: 0.1 })
    const sideMat = new THREE.MeshStandardMaterial({ color: 0xbfbfbf, roughness: 0.4, metalness: 0.1 })
    const materials = [sideMat, sideMat, topMat, sideMat, frontMat, sideMat]

    // Create environment meshes
    sceneData.asset_transforms.forEach((t, i) => {
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
      this.environmentMeshes.push(mesh)
    })

    // 2. Build BVH Collision Tree
    const geometries: THREE.BufferGeometry[] = []

    // Add floor box geometry to match vertex layout of boxes (centered at -1.05 height, thin box)
    const floorBox = new THREE.BoxGeometry(50, 0.1, 50)
    floorBox.translate(0, -1.05, 0)
    geometries.push(floorBox)

    // Add all assets geometries transformed to their world positions
    this.environmentMeshes.forEach((mesh) => {
      mesh.updateMatrixWorld(true)
      const geom = mesh.geometry.clone()
      geom.applyMatrix4(mesh.matrixWorld)
      geometries.push(geom)
    })

    if (geometries.length > 0) {
      const mergedGeom = BufferGeometryUtils.mergeGeometries(geometries)
      this.colliderBVH = new MeshBVH(mergedGeom)

      // Create collider visualizer
      const colliderMesh = new THREE.Mesh(mergedGeom, new THREE.MeshBasicMaterial({
        color: 0x00ff00,
        wireframe: true,
        transparent: true,
        opacity: 0.3,
        depthWrite: false
      }))
      this.colliderVisualizer = colliderMesh
      this.colliderVisualizer.visible = this.displayCollider
      this.scene.add(this.colliderVisualizer)

      // Create BVH Helper visualizer
      this.bvhHelper = new MeshBVHHelper(colliderMesh)
      this.bvhHelper.visible = this.displayBVH
      this.scene.add(this.bvhHelper)

      // Clean up cloned geometries
      geometries.forEach(g => g.dispose())
    } else {
      this.colliderBVH = null
    }
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
    // Capsule height = 1.2, bottom sphere Y = 0.3. Set Y position to 0.6 so base starts exactly at Y = 0
    bodyMesh.position.y = 0.6
    bodyMesh.castShadow = true
    bodyMesh.receiveShadow = true
    this.characterGroup.add(bodyMesh)

    this.characterGroup.position.copy(this.characterPosition)
    this.scene.add(this.characterGroup)
  }

  private bindEvents(): void {
    this.container.addEventListener('mouseenter', () => {
      this.isHovered = true
    })

    this.container.addEventListener('mouseleave', () => {
      this.isHovered = false
    })

    // Keyboard listeners when mouse is hovered over canvas (Arrow keys only for keysPressed)
    this.keydownHandler = (e: KeyboardEvent) => {
      if (!this.isHovered) return
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) {
        e.preventDefault()
        this.keysPressed[e.code] = true
      }
      if (e.code === 'Space') {
        e.preventDefault()
        if (e.repeat) return
        if (this.isOnGround) {
          this.characterVelocity.y = 10.0 // Jump vertical impulse (matching example)
          this.isOnGround = false
        }
      }
    }

    this.keyupHandler = (e: KeyboardEvent) => {
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) {
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

  private updateCharacterMovement(dt: number): void {
    if (!this.characterGroup) return

    const physicsSteps = 5
    const stepDt = dt / physicsSteps
    const speed = this.state.character_speed // use direct speed (default 10.0)

    // 1. Determine horizontal intent from key presses
    let moveZ = 0
    let moveX = 0

    if (this.keysPressed['ArrowUp']) moveZ -= 1
    if (this.keysPressed['ArrowDown']) moveZ += 1
    if (this.keysPressed['ArrowLeft']) moveX -= 1
    if (this.keysPressed['ArrowRight']) moveX += 1

    let dir = new THREE.Vector3(moveX, 0, moveZ)
    if (dir.lengthSq() > 0) {
      dir.normalize()
      const targetAngle = Math.atan2(dir.x, dir.z)
      this.characterGroup.rotation.y = targetAngle
    }

    // Apply horizontal velocity (matching example)
    this.characterVelocity.x = dir.x * speed
    this.characterVelocity.z = dir.z * speed

    // Run physics simulation and collision resolution in multiple substeps
    for (let step = 0; step < physicsSteps; step++) {
      // Apply gravity (matching example -30)
      this.characterVelocity.y -= 30 * stepDt

      // Apply tentative position update
      const tentativeY = this.characterPosition.y
      this.characterPosition.addScaledVector(this.characterVelocity, stepDt)

      // Force floor lock constraint: character can never fall below y=-1.0 (failsafe)
      if (this.characterPosition.y < -1.0) {
        this.characterPosition.y = -1.0
        this.characterVelocity.y = 0
        this.isOnGround = true
      }

      // Limit boundaries of characterPosition
      this.characterPosition.x = Math.max(-24, Math.min(24, this.characterPosition.x))
      this.characterPosition.z = Math.max(-24, Math.min(24, this.characterPosition.z))

      // 2. Perform BVH Collision Resolution
      if (this.colliderBVH) {
        const radius = 0.3
        const height = 0.6 // Cylinder height between capsule spheres

        const tempSegment = new THREE.Line3()
        tempSegment.start.copy(this.characterPosition)
        tempSegment.start.y += radius

        tempSegment.end.copy(this.characterPosition)
        tempSegment.end.y += radius + height

        const capsuleBounds = new THREE.Box3()
        capsuleBounds.min.copy(this.characterPosition)
        capsuleBounds.min.x -= radius
        capsuleBounds.min.z -= radius
        capsuleBounds.max.copy(this.characterPosition)
        capsuleBounds.max.x += radius
        capsuleBounds.max.z += radius
        capsuleBounds.max.y += radius + height + radius

        const tempVector = new THREE.Vector3()
        const tempVector2 = new THREE.Vector3()

        // Resolve intersections
        this.colliderBVH.shapecast({
          intersectsBounds: box => box.intersectsBox(capsuleBounds),
          intersectsTriangle: (tri) => {
            const triPoint = tempVector
            const capsulePoint = tempVector2
            const distSq = tri.closestPointToSegment(tempSegment, triPoint, capsulePoint)
            const dist = Math.sqrt(distSq)

            if (dist < radius) {
              const depth = radius - dist
              const direction = capsulePoint.sub(triPoint).normalize()
              
              tempSegment.start.addScaledVector(direction, depth)
              tempSegment.end.addScaledVector(direction, depth)
            }
          }
        })

        // Check if Y collision pushed us upwards or downwards (ground and ceiling collision)
        const resolvedY = tempSegment.start.y - radius
        const deltaY = resolvedY - tentativeY
        if (deltaY > 0.001) {
          // Only land (stop velocity and set grounded) if we are falling or stationary
          if (this.characterVelocity.y <= 0) {
            this.characterVelocity.y = 0
            this.isOnGround = true
          }
        } else if (deltaY < -0.001) {
          // Hit a ceiling: stop upward velocity if we were rising
          if (this.characterVelocity.y > 0) {
            this.characterVelocity.y = 0
          }
        }

        this.characterPosition.copy(tempSegment.start)
        this.characterPosition.y -= radius
      }
    }

    // Set characterGroup position
    this.characterGroup.position.copy(this.characterPosition)
  }

  public setDisplayCollider(val: boolean): void {
    this.displayCollider = val
    if (this.colliderVisualizer) {
      this.colliderVisualizer.visible = val
    }
  }

  public setDisplayBVH(val: boolean): void {
    this.displayBVH = val
    if (this.bvhHelper) {
      this.bvhHelper.visible = val
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

    // Calculate real frame delta time (independent of frame rate / monitor refresh rate)
    const time = performance.now()
    const dt = Math.min((time - this.lastTime) / 1000, 0.1) // Cap at 0.1s to prevent lag glitches
    this.lastTime = time

    this.updateCharacterMovement(dt)

    // Camera following character
    if (this.characterGroup) {
      this.camera.position.set(
        this.characterPosition.x,
        this.characterPosition.y + 4,
        this.characterPosition.z + 8
      )
      this.camera.lookAt(
        this.characterPosition.x,
        this.characterPosition.y + 0.5,
        this.characterPosition.z
      )
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

    if (this.keydownHandler) {
      window.removeEventListener('keydown', this.keydownHandler)
    }
    if (this.keyupHandler) {
      window.removeEventListener('keyup', this.keyupHandler)
    }

    this.renderer.dispose()
    this.scene.clear()
  }
}
