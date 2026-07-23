import * as THREE from 'three'
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js'
import { MeshBVH, MeshBVHHelper } from 'three-mesh-bvh'
import type { ActingState, ThreeActingOptions, CubeTransform, SceneState } from './types'
import * as config from './threeConfig'

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
  private mainLight!: THREE.DirectionalLight
  private animationId: number | null = null
  private isHovered = false
  private connectedThreeScene: any = null
  private clonedEnvGroup: THREE.Group | null = null

  private isRecording = false
  private isPlaying = false
  private recordingTime = 0
  private playbackTime = 0
  private trajectory: Array<{ t: number, px: number, py: number, pz: number, ry: number }> = []
  private onRecordingFinished?: (trajectoryJson: string) => void

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
    this.onRecordingFinished = options.onRecordingFinished
    this.connectedThreeScene = options.connectedThreeScene ?? null
    this.state = {
      character_speed: options.initialState?.character_speed ?? 10.0,
      duration: options.initialState?.duration ?? 7.0,
      motion_data: options.initialState?.motion_data ?? '',
      scene_data: options.initialState?.scene_data ?? null as any,
    }

    if (this.state.motion_data) {
      this.loadTrajectory(this.state.motion_data)
    }

    this.initThreeJS()
    this.bindEvents()
    this.animate()
  }

  public setConnectedThreeScene(threeScene: any): void {
    this.connectedThreeScene = threeScene
    this.buildSceneEnvironment()
  }

  public startRecording(): void {
    this.trajectory = []
    this.isRecording = true
    this.recordingTime = 0
    this.isPlaying = false
  }

  public stopRecording(): string {
    this.isRecording = false
    const json = JSON.stringify(this.trajectory)
    this.state.motion_data = json
    if (this.onStateChange) {
      this.onStateChange({ ...this.state })
    }
    return json
  }

  public startPlayback(trajectoryJson?: string): void {
    if (trajectoryJson) {
      this.loadTrajectory(trajectoryJson)
    }
    if (this.trajectory.length > 0) {
      this.isPlaying = true
      this.playbackTime = 0
      this.isRecording = false
    }
  }

  public stopPlayback(): void {
    this.isPlaying = false
  }

  public loadTrajectory(trajectoryJson: string): void {
    if (trajectoryJson && trajectoryJson.trim()) {
      try {
        this.trajectory = JSON.parse(trajectoryJson)
        this.trajectory.sort((a, b) => a.t - b.t)
      } catch (e) {
        this.trajectory = []
      }
    } else {
      this.trajectory = []
    }
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

    // Build environment and character
    this.buildSceneEnvironment()
    this.buildCharacter()
  }

  private buildSceneEnvironment(): void {
    // 1. Cleanup old cloned environment group if present
    if (this.clonedEnvGroup) {
      this.scene.remove(this.clonedEnvGroup)
      // Traverse to dispose child geometries and materials to avoid memory leaks
      this.clonedEnvGroup.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose()
          if (Array.isArray(child.material)) {
            child.material.forEach((m) => m.dispose())
          } else {
            child.material.dispose()
          }
        }
      })
      this.clonedEnvGroup = null
    }

    this.environmentMeshes = []
    this.mainLight = null as any

    if (this.connectedThreeScene) {
      const sourceScene = this.connectedThreeScene.getScene()
      const transformHelper = this.connectedThreeScene.getTransformHelper()

      this.clonedEnvGroup = new THREE.Group()
      this.scene.add(this.clonedEnvGroup)

      // Clone and add each child of the source Scene except the transform controls helper
      sourceScene.children.forEach((child: THREE.Object3D) => {
        if (child !== transformHelper) {
          const cloned = child.clone()
          this.clonedEnvGroup!.add(cloned)
        }
      })

      // Traverse cloned group to identify main light and asset meshes
      this.clonedEnvGroup.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          // Skip the mesh named 'floor' so we don't treat it as a box collider for character physics
          if (child.name !== 'floor') {
            this.environmentMeshes.push(child)
          }
        } else if (child instanceof THREE.DirectionalLight && child.castShadow) {
          this.mainLight = child
          // DirectionalLight.target needs to be in the scene to update its world matrix
          this.scene.add(this.mainLight.target)
        }
      })
    } else if (this.state.scene_data && (this.state.scene_data.asset_transforms?.length || this.state.scene_data.num_assets)) {
      // Reconstruct scene environment from scene_data state JSON
      this.clonedEnvGroup = new THREE.Group()
      this.scene.add(this.clonedEnvGroup)

      const ambientLight = new THREE.AmbientLight(config.AMBIENT_LIGHT_COLOR, config.AMBIENT_LIGHT_INTENSITY)
      this.clonedEnvGroup.add(ambientLight)

      this.mainLight = new THREE.DirectionalLight(config.MAIN_LIGHT_COLOR, config.MAIN_LIGHT_INTENSITY)
      this.mainLight.position.copy(config.MAIN_LIGHT_OFFSET)
      this.mainLight.castShadow = true
      this.mainLight.shadow.mapSize.width = config.SHADOW_MAP_WIDTH
      this.mainLight.shadow.mapSize.height = config.SHADOW_MAP_HEIGHT
      this.mainLight.shadow.bias = config.SHADOW_BIAS
      this.mainLight.shadow.normalBias = config.SHADOW_NORMAL_BIAS
      const d = config.SHADOW_FRUSTUM_SIZE
      this.mainLight.shadow.camera.left = -d
      this.mainLight.shadow.camera.right = d
      this.mainLight.shadow.camera.top = d
      this.mainLight.shadow.camera.bottom = -d
      this.scene.add(this.mainLight.target)
      this.clonedEnvGroup.add(this.mainLight)

      const gridHelper = new THREE.GridHelper(
        config.GRID_SIZE,
        config.GRID_DIVISIONS,
        config.GRID_COLOR_CENTER,
        config.GRID_COLOR_GRID
      )
      gridHelper.position.y = -1.0
      this.clonedEnvGroup.add(gridHelper)

      const floorGeo = new THREE.PlaneGeometry(100, 100)
      const floorMat = new THREE.MeshStandardMaterial({
        color: 0xdbdbdb,
        roughness: 1,
        metalness: 0
      })
      const floorMesh = new THREE.Mesh(floorGeo, floorMat)
      floorMesh.name = 'floor'
      floorMesh.rotation.x = -Math.PI / 2
      floorMesh.position.y = -1.002
      floorMesh.receiveShadow = true
      this.clonedEnvGroup.add(floorMesh)

      // Reconstruct asset meshes matching ThreeScene materials
      const frontMat = new THREE.MeshStandardMaterial({ color: 0x3d4974, roughness: 0.4, metalness: 0.1 })
      const topMat = new THREE.MeshStandardMaterial({ color: 0xe6e6e6, roughness: 0.4, metalness: 0.1 })
      const sideMat = new THREE.MeshStandardMaterial({ color: 0xbfbfbf, roughness: 0.4, metalness: 0.1 })
      const materials = [sideMat, sideMat, topMat, sideMat, frontMat, sideMat]

      const transforms = this.state.scene_data.asset_transforms ?? []
      transforms.forEach((t) => {
        const geometry = new THREE.BoxGeometry(1, 1, 1)
        const mesh = new THREE.Mesh(geometry, materials)
        mesh.position.set(t.px, t.py, t.pz)
        mesh.rotation.set(t.rx, t.ry, t.rz)
        mesh.scale.set(t.sx, t.sy, t.sz)
        mesh.castShadow = true
        mesh.receiveShadow = true
        this.clonedEnvGroup!.add(mesh)
        this.environmentMeshes.push(mesh)
      })
    } else {
      // Fallback: Create simple grid and ambient/directional lights if no SceneNode is connected yet
      this.clonedEnvGroup = new THREE.Group()
      this.scene.add(this.clonedEnvGroup)

      const ambientLight = new THREE.AmbientLight(config.AMBIENT_LIGHT_COLOR, config.AMBIENT_LIGHT_INTENSITY)
      this.clonedEnvGroup.add(ambientLight)

      this.mainLight = new THREE.DirectionalLight(config.MAIN_LIGHT_COLOR, config.MAIN_LIGHT_INTENSITY)
      this.mainLight.position.copy(config.MAIN_LIGHT_OFFSET)
      this.mainLight.castShadow = true
      this.mainLight.shadow.mapSize.width = config.SHADOW_MAP_WIDTH
      this.mainLight.shadow.mapSize.height = config.SHADOW_MAP_HEIGHT
      this.mainLight.shadow.bias = config.SHADOW_BIAS
      this.mainLight.shadow.normalBias = config.SHADOW_NORMAL_BIAS
      const d = config.SHADOW_FRUSTUM_SIZE
      this.mainLight.shadow.camera.left = -d
      this.mainLight.shadow.camera.right = d
      this.mainLight.shadow.camera.top = d
      this.mainLight.shadow.camera.bottom = -d
      this.scene.add(this.mainLight.target)
      this.clonedEnvGroup.add(this.mainLight)

      const gridHelper = new THREE.GridHelper(
        config.GRID_SIZE,
        config.GRID_DIVISIONS,
        config.GRID_COLOR_CENTER,
        config.GRID_COLOR_GRID
      )
      gridHelper.position.y = -1.0
      this.clonedEnvGroup.add(gridHelper)

      const floorGeo = new THREE.PlaneGeometry(100, 100)
      const floorMat = new THREE.MeshStandardMaterial({
        color: 0xdbdbdb,
        roughness: 1,
        metalness: 0
      })
      const floorMesh = new THREE.Mesh(floorGeo, floorMat)
      floorMesh.name = 'floor'
      floorMesh.rotation.x = -Math.PI / 2
      floorMesh.position.y = -1.002
      floorMesh.receiveShadow = true
      this.clonedEnvGroup.add(floorMesh)
    }

    // 2. Build BVH Collision Tree
    const geometries: THREE.BufferGeometry[] = []

    // Add floor box geometry to match vertex layout of boxes (centered at -1.05 height, thin box)
    const floorBox = new THREE.BoxGeometry(100, 0.1, 100)
    floorBox.translate(0, -1.05, 0)
    geometries.push(floorBox)

    // Add all asset meshes geometries transformed to their world positions
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
      if (this.colliderVisualizer) {
        this.scene.remove(this.colliderVisualizer)
        this.colliderVisualizer.geometry.dispose()
      }
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
      if (this.bvhHelper) {
        this.scene.remove(this.bvhHelper)
      }
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
    this.characterGroup.name = 'characterGroup'

    // Character body (Capsule/Cylinder)
    const bodyGeo = new THREE.CapsuleGeometry(0.25, 0.85, 8, 16)
    const bodyMat = new THREE.MeshStandardMaterial({
      color: 0xff007f,
      roughness: 0.2,
      metalness: 0.5,
    })
    const bodyMesh = new THREE.Mesh(bodyGeo, bodyMat)
    // Capsule height = 1.7, bottom sphere Y = 0.25. Set Y position to 0.85 so base starts exactly at Y = 0
    bodyMesh.position.y = 0.85
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

    // 1. Playback Mode
    if (this.isPlaying) {
      if (this.trajectory.length === 0) {
        this.isPlaying = false
        return
      }

      this.playbackTime += dt
      const maxDuration = this.state.duration

      // Loop playback at duration boundary
      if (this.playbackTime >= maxDuration) {
        this.playbackTime = this.playbackTime % maxDuration
      }

      const t = this.playbackTime

      // Find frame interval
      let idxA = 0
      for (let i = 0; i < this.trajectory.length; i++) {
        if (this.trajectory[i].t <= t) {
          idxA = i
        } else {
          break
        }
      }
      const idxB = (idxA + 1) % this.trajectory.length
      const frameA = this.trajectory[idxA]
      const frameB = this.trajectory[idxB]

      let factor = 0
      let timeDiff = frameB.t - frameA.t
      if (timeDiff < 0) {
        // Loops around at end
        timeDiff = (maxDuration - frameA.t) + frameB.t
        const elapsedSinceA = t - frameA.t
        factor = timeDiff > 0 ? elapsedSinceA / timeDiff : 0
      } else {
        const elapsedSinceA = t - frameA.t
        factor = timeDiff > 0 ? elapsedSinceA / timeDiff : 0
      }

      // Linear interpolate position
      this.characterPosition.set(
        frameA.px + (frameB.px - frameA.px) * factor,
        frameA.py + (frameB.py - frameA.py) * factor,
        frameA.pz + (frameB.pz - frameA.pz) * factor
      )

      // Shortest angle rotation interpolation
      let diffY = frameB.ry - frameA.ry
      diffY = Math.atan2(Math.sin(diffY), Math.cos(diffY))
      this.characterGroup.rotation.y = frameA.ry + diffY * factor
      this.characterGroup.position.copy(this.characterPosition)
      return
    }

    const physicsSteps = 5
    const stepDt = dt / physicsSteps
    const speed = this.state.character_speed

    // 2. Determine horizontal intent from key presses
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

    // Apply horizontal velocity
    this.characterVelocity.x = dir.x * speed
    this.characterVelocity.z = dir.z * speed

    // Run physics simulation and collision resolution in multiple substeps
    for (let step = 0; step < physicsSteps; step++) {
      // Apply gravity
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

      // Perform BVH Collision Resolution
      if (this.colliderBVH) {
        const radius = 0.3
        const height = 0.9

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

        // Check if Y collision pushed us upwards or downwards
        const resolvedY = tempSegment.start.y - radius
        const deltaY = resolvedY - tentativeY
        if (deltaY > 0.001) {
          if (this.characterVelocity.y <= 0) {
            this.characterVelocity.y = 0
            this.isOnGround = true
          }
        } else if (deltaY < -0.001) {
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

    // 3. Record coordinates if in recording state
    if (this.isRecording) {
      this.trajectory.push({
        t: this.recordingTime,
        px: this.characterPosition.x,
        py: this.characterPosition.y,
        pz: this.characterPosition.z,
        ry: this.characterGroup.rotation.y
      })

      this.recordingTime += dt

      if (this.recordingTime >= this.state.duration) {
        const json = this.stopRecording()
        if (this.onRecordingFinished) {
          this.onRecordingFinished(json)
        }
      }
    }
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

      // Update main directional light to follow the character for high-quality shadows
      if (this.mainLight) {
        this.mainLight.position.copy(this.characterPosition).add(config.MAIN_LIGHT_OFFSET)
        this.mainLight.target.position.copy(this.characterPosition)
        this.mainLight.target.updateMatrixWorld()
      }
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
    if (newState.duration !== undefined) {
      this.state.duration = newState.duration
    }
    if (newState.motion_data !== undefined) {
      this.state.motion_data = newState.motion_data
      this.loadTrajectory(newState.motion_data)
    }
    if (newState.scene_data !== undefined) {
      this.state.scene_data = { ...newState.scene_data }
      this.buildSceneEnvironment()
    }
  }

  public getCurrentTime(): number {
    if (this.isRecording) return this.recordingTime
    if (this.isPlaying) return this.playbackTime
    return 0
  }

  public getDuration(): number {
    return this.state.duration ?? 7.0
  }

  public getScene(): THREE.Scene {
    return this.scene
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
