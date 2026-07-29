import * as THREE from 'three'
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js'
import { MeshBVH, MeshBVHHelper } from 'three-mesh-bvh'
import type { ActingState, ThreeActingOptions, CubeTransform, SceneState } from './types'
import * as config from './threeConfig'
import { BaseActor } from './actors/BaseActor'
import { ActorFactory } from './actors/ActorFactory'

export class ThreeActing {
  private container: HTMLElement
  private state: ActingState
  private onStateChange?: (state: ActingState) => void

  private scene!: THREE.Scene
  private camera!: THREE.PerspectiveCamera
  private renderer!: THREE.WebGLRenderer
  private environmentMeshes: THREE.Mesh[] = []
  private actorController!: BaseActor
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

  // Actor movement & physics control state
  private keysPressed: Record<string, boolean> = {}
  private lastTime = performance.now()
  private keydownHandler?: (e: KeyboardEvent) => void
  private keyupHandler?: (e: KeyboardEvent) => void
  private resizeObserver: ResizeObserver | null = null
  private resizeAnimationFrameId: number | null = null

  constructor(options: ThreeActingOptions) {
    this.container = options.container
    this.onStateChange = options.onStateChange
    this.onRecordingFinished = options.onRecordingFinished
    this.connectedThreeScene = options.connectedThreeScene ?? null
    this.state = {
      actor_type: options.initialState?.actor_type ?? 'human',
      actor_speed: options.initialState?.actor_speed ?? 10.0,
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

    // Build environment and actor
    this.buildSceneEnvironment()
    this.buildActor(this.state.actor_type)
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
          // Skip the mesh named 'floor' so we don't treat it as a box collider for actor physics
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

  private buildActor(type?: 'human' | 'car'): void {
    const charType = type ?? this.state.actor_type ?? 'human'
    if (this.actorController) {
      this.scene.remove(this.actorController.group)
      this.actorController.dispose()
    }
    this.actorController = ActorFactory.create(charType)
    this.scene.add(this.actorController.group)
  }

  private bindEvents(): void {
    this.container.addEventListener('mouseenter', () => {
      this.isHovered = true
    })

    this.container.addEventListener('mouseleave', () => {
      this.isHovered = false
    })

    // Keyboard listeners when mouse is hovered over canvas (WASD + Arrow keys)
    this.keydownHandler = (e: KeyboardEvent) => {
      if (!this.isHovered) return
      const isMovementKey = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(e.code)
      if (isMovementKey) {
        e.preventDefault()
        e.stopPropagation()
        e.stopImmediatePropagation()
        this.keysPressed[e.code] = true
      }
      if (e.code === 'Space') {
        e.preventDefault()
        e.stopPropagation()
        e.stopImmediatePropagation()
        if (e.repeat) return
        if (this.actorController && this.actorController.isOnGround) {
          this.actorController.velocity.y = 10.0 // Jump vertical impulse
          this.actorController.isOnGround = false
        }
      }
    }

    this.keyupHandler = (e: KeyboardEvent) => {
      const isMovementKey = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(e.code)
      if (this.isHovered && (isMovementKey || e.code === 'Space')) {
        e.preventDefault()
        e.stopPropagation()
        e.stopImmediatePropagation()
      }
      if (isMovementKey) {
        this.keysPressed[e.code] = false
      }
    }

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

  private updateActorMovement(dt: number): void {
    if (!this.actorController) return

    // 1. Playback Mode
    if (this.isPlaying) {
      if (this.trajectory.length === 0) {
        this.isPlaying = false
        return
      }

      this.playbackTime += dt
      const maxDuration = this.state.duration

      if (this.playbackTime >= maxDuration) {
        this.playbackTime = this.playbackTime % maxDuration
      }

      const t = this.playbackTime

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
        timeDiff = (maxDuration - frameA.t) + frameB.t
        const elapsedSinceA = t - frameA.t
        factor = timeDiff > 0 ? elapsedSinceA / timeDiff : 0
      } else {
        const elapsedSinceA = t - frameA.t
        factor = timeDiff > 0 ? elapsedSinceA / timeDiff : 0
      }

      const px = frameA.px + (frameB.px - frameA.px) * factor
      const py = frameA.py + (frameB.py - frameA.py) * factor
      const pz = frameA.pz + (frameB.pz - frameA.pz) * factor

      let diffY = frameB.ry - frameA.ry
      diffY = Math.atan2(Math.sin(diffY), Math.cos(diffY))
      const ry = frameA.ry + diffY * factor

      this.actorController.setPosition(px, py, pz, ry)
      return
    }

    // 2. Physics & Interactive Controls
    this.actorController.updatePhysics(
      dt,
      this.keysPressed,
      this.state.actor_speed,
      this.colliderBVH
    )

    // 3. Record coordinates if in recording state
    if (this.isRecording) {
      this.trajectory.push({
        t: this.recordingTime,
        px: this.actorController.position.x,
        py: this.actorController.position.y,
        pz: this.actorController.position.z,
        ry: this.actorController.rotationY
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

    const time = performance.now()
    const dt = Math.min((time - this.lastTime) / 1000, 0.1)
    this.lastTime = time

    this.updateActorMovement(dt)

    // Camera following actor
    if (this.actorController) {
      const pos = this.actorController.position
      this.camera.position.set(
        pos.x,
        pos.y + 4,
        pos.z + 8
      )
      this.camera.lookAt(
        pos.x,
        pos.y + 0.5,
        pos.z
      )

      if (this.mainLight) {
        this.mainLight.position.copy(pos).add(config.MAIN_LIGHT_OFFSET)
        this.mainLight.target.position.copy(pos)
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
    if (newState.actor_type !== undefined && newState.actor_type !== this.state.actor_type) {
      this.state.actor_type = newState.actor_type
      this.buildActor(newState.actor_type)
    }
    if (newState.actor_speed !== undefined) {
      this.state.actor_speed = newState.actor_speed
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

    if (this.resizeAnimationFrameId !== null) {
      cancelAnimationFrame(this.resizeAnimationFrameId)
      this.resizeAnimationFrameId = null
    }

    if (this.resizeObserver) {
      this.resizeObserver.disconnect()
      this.resizeObserver = null
    }

    if (this.keydownHandler) {
      window.removeEventListener('keydown', this.keydownHandler, { capture: true })
    }
    if (this.keyupHandler) {
      window.removeEventListener('keyup', this.keyupHandler, { capture: true })
    }

    this.renderer.dispose()
    this.scene.clear()
  }
}
