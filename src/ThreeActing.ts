import * as THREE from 'three'
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js'
import { MeshBVH, BVHHelper } from 'three-mesh-bvh'
import type { ActingState, ThreeActingOptions, CubeTransform, SceneState } from './types'
import * as config from './threeConfig'
import { BaseActor } from './actors/BaseActor'
import { ActorFactory } from './actors/ActorFactory'
import { DebugPanel } from './utils/DebugPanel'
import { PlaybackController } from './utils/PlaybackController'
import { SceneHierarchyManager } from './scene/SceneHierarchyManager'

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
  private debugPanel: DebugPanel | null = null

  private isRecording = false
  private isPlaying = false
  private recordingTime = 0
  private activeRecordingTargetDuration = 7.0
  private activeRecordingSpeed = 1.0
  private playbackController = new PlaybackController()
  private trajectory: Array<any> = []
  private onRecordingFinished?: (trajectoryJson: string) => void

  // BVH Collision data
  private colliderBVH: MeshBVH | null = null
  private bvhHelper: BVHHelper | null = null
  private colliderVisualizer: THREE.Mesh | null = null
  private displayBVH = false
  private displayCollider = false
  private displayActorCollider = false

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
      actor_speed: options.initialState?.actor_speed ?? 1.0,
      duration: options.initialState?.duration ?? 8.0,
      motion_data: options.initialState?.motion_data ?? '',
      scene_data: options.initialState?.scene_data ?? { type: 'cube_scene', num_assets: 0, nodes: [] } as any,
    }

    this.initThreeJS()
    this.bindEvents()

    if (this.state.motion_data) {
      this.loadTrajectory(this.state.motion_data)
    }

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
    this.activeRecordingTargetDuration = this.state.duration ?? 7.0
    this.activeRecordingSpeed = this.state.actor_speed ?? 1.0
  }

  public getActorType(): 'human' | 'car' {
    return this.actorController ? this.actorController.getType() : 'human'
  }

  public stopRecording(): string {
    this.isRecording = false
    const payload = {
      actor_type: this.getActorType(),
      motion_data: this.trajectory,
      scene_data: this.state.scene_data ?? null
    }
    const json = JSON.stringify(payload)
    this.state.motion_data = json
    this.playbackController.setTrajectory(json)
    if (this.onStateChange) {
      this.onStateChange({ ...this.state })
    }
    return json
  }

  public startPlayback(trajectoryJson?: string): void {
    if (trajectoryJson) {
      this.loadTrajectory(trajectoryJson)
    }
    this.playbackController.start()
    this.isPlaying = this.playbackController.getIsPlaying()
    this.isRecording = false
  }

  public play(): void {
    this.playbackController.play()
    this.isPlaying = true
    this.isRecording = false
  }

  public pause(): void {
    this.playbackController.pause()
    this.isPlaying = false
  }

  public stop(): void {
    this.playbackController.stop()
    this.isPlaying = false
    this.resetActorPosition()
  }

  public stopPlayback(): void {
    this.stop()
  }

  public loadTrajectory(trajectoryJson: string): void {
    this.playbackController.setTrajectory(trajectoryJson)
    this.trajectory = this.playbackController.getTrajectory()
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

    // Build environment and actor
    this.buildSceneEnvironment()
    this.buildActor(this.state.actor_type)

    // Initialize Debug Panel with lil-gui
    this.debugPanel = new DebugPanel(this.container)
    this.debugPanel.attachThreeActing(this)
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
    } else if (this.state.scene_data && (this.state.scene_data.nodes?.length || this.state.scene_data.num_assets)) {
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
      gridHelper.position.y = config.GRID_Y
      this.clonedEnvGroup.add(gridHelper)

      const floorGeo = new THREE.PlaneGeometry(100, 100)
      const floorMat = new THREE.MeshStandardMaterial({
        color: config.FLOOR_COLOR,
        roughness: config.FLOOR_ROUGHNESS,
        metalness: config.FLOOR_METALNESS
      })
      const floorMesh = new THREE.Mesh(floorGeo, floorMat)
      floorMesh.name = 'floor'
      floorMesh.rotation.x = -Math.PI / 2
      floorMesh.position.y = config.FLOOR_Y
      floorMesh.receiveShadow = true
      this.clonedEnvGroup.add(floorMesh)

      const nodes = this.state.scene_data.nodes ?? []
      const hierarchyManager = new SceneHierarchyManager()
      nodes.forEach((nodeData) => {
        const obj = hierarchyManager.buildNodeFromData(nodeData)
        this.clonedEnvGroup!.add(obj)
        if (obj instanceof THREE.Mesh) {
          this.environmentMeshes.push(obj)
        } else {
          obj.traverse((child) => {
            if (child instanceof THREE.Mesh) {
              this.environmentMeshes.push(child)
            }
          })
        }
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
      gridHelper.position.y = config.GRID_Y
      this.clonedEnvGroup.add(gridHelper)

      const floorGeo = new THREE.PlaneGeometry(100, 100)
      const floorMat = new THREE.MeshStandardMaterial({
        color: config.FLOOR_COLOR,
        roughness: config.FLOOR_ROUGHNESS,
        metalness: config.FLOOR_METALNESS
      })
      const floorMesh = new THREE.Mesh(floorGeo, floorMat)
      floorMesh.name = 'floor'
      floorMesh.rotation.x = -Math.PI / 2
      floorMesh.position.y = config.FLOOR_Y
      floorMesh.receiveShadow = true
      this.clonedEnvGroup.add(floorMesh)
    }

    // 2. Build BVH Collision Tree
    const geometries: THREE.BufferGeometry[] = []

    // Add floor box geometry to match vertex layout of boxes (centered at -0.05 height, thin box top at Y=0)
    const floorBox = new THREE.BoxGeometry(100, 0.1, 100)
    floorBox.translate(0, -0.05, 0)
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
      ;(mergedGeom as any).boundsTree = this.colliderBVH

      // Create collider visualizer (Green Wireframe Mesh of stage geometry)
      if (this.colliderVisualizer) {
        this.scene.remove(this.colliderVisualizer)
        this.colliderVisualizer.geometry.dispose()
      }
      const colliderMesh = new THREE.Mesh(mergedGeom, new THREE.MeshBasicMaterial({
        color: 0x00ff44,
        wireframe: true,
        transparent: true,
        opacity: 0.6,
        depthTest: false,
        depthWrite: false
      }))
      colliderMesh.renderOrder = 998
      this.colliderVisualizer = colliderMesh
      this.colliderVisualizer.visible = this.displayCollider
      this.scene.add(this.colliderVisualizer)

      // Create BVH Helper visualizer (Yellow Bounding Boxes of BVH tree nodes)
      if (this.bvhHelper) {
        this.scene.remove(this.bvhHelper)
      }
      this.bvhHelper = new BVHHelper(colliderMesh, 10)
      if ((this.bvhHelper as any).color?.set) {
        ;(this.bvhHelper as any).color.set(0xffff00)
      }
      this.bvhHelper.visible = this.displayBVH
      this.bvhHelper.renderOrder = 999
      this.bvhHelper.traverse((child: THREE.Object3D) => {
        if (child instanceof THREE.LineSegments && child.material) {
          const mats = Array.isArray(child.material) ? child.material : [child.material]
          mats.forEach((m) => {
            m.depthTest = false
            m.depthWrite = false
            m.transparent = true
          })
        }
      })
      this.bvhHelper.update()
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
    this.actorController.setDisplayCollider(this.displayActorCollider)
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
      const isMovementKey = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space'].includes(e.code)
      if (isMovementKey) {
        e.preventDefault()
        e.stopPropagation()
        e.stopImmediatePropagation()
        this.keysPressed[e.code] = true
      }
      if (e.code === 'Space') {
        if (e.repeat) return
        if (this.actorController) {
          this.actorController.jump()
        }
      }
    }

    this.keyupHandler = (e: KeyboardEvent) => {
      const isMovementKey = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space'].includes(e.code)
      if (this.isHovered && isMovementKey) {
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

    // 1. Playback / Paused Replay Mode (when recorded trajectory is loaded)
    if (this.playbackController.getTrajectory().length > 0 && !this.isRecording) {
      this.playbackController.update(dt, this.actorController)
      return
    }

    const currentSpeed = this.isRecording ? this.activeRecordingSpeed : this.state.actor_speed

    // 2. Physics & Interactive WASD Controls (Live Mode)
    this.actorController.updatePhysics(
      dt,
      this.keysPressed,
      currentSpeed,
      this.colliderBVH
    )

    // 3. Record coordinates if in recording state
    if (this.isRecording) {
      this.trajectory.push(this.actorController.getMotionState(this.recordingTime))

      this.recordingTime += dt

      if (this.recordingTime >= this.activeRecordingTargetDuration) {
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

  public getDisplayCollider(): boolean {
    return this.displayCollider
  }

  public setDisplayActorCollider(val: boolean): void {
    this.displayActorCollider = val
    if (this.actorController) {
      this.actorController.setDisplayCollider(val)
    }
  }

  public getDisplayActorCollider(): boolean {
    return this.displayActorCollider
  }

  public setDisplayBVH(val: boolean): void {
    this.displayBVH = val
    if (this.bvhHelper) {
      this.bvhHelper.visible = val
      if (val) {
        this.bvhHelper.update()
      }
    }
  }

  public getDisplayBVH(): boolean {
    return this.displayBVH
  }

  public resetActorPosition(): void {
    if (this.actorController) {
      this.actorController.resetToOrigin()
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
    if (this.isPlaying) return this.playbackController.getCurrentTime()
    return 0
  }

  public getDuration(): number {
    if (this.isRecording) {
      return this.activeRecordingTargetDuration
    }
    if (this.playbackController.getTrajectory().length > 0) {
      return this.playbackController.getMaxDuration() || (this.state.duration ?? 7.0)
    }
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

    if (this.debugPanel) {
      this.debugPanel.dispose()
      this.debugPanel = null
    }

    this.renderer.dispose()
    this.scene.clear()
  }
}
