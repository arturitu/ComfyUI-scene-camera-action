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
import { StageEnvironment } from './scene/StageEnvironment'

export class ThreeActing {
  private container: HTMLElement
  private state: ActingState
  private onStateChange?: (state: ActingState) => void

  private scene!: THREE.Scene
  private camera!: THREE.PerspectiveCamera
  private renderer!: THREE.WebGLRenderer
  private environmentMeshes: THREE.Mesh[] = []
  private actorController!: BaseActor
  private animationId: number | null = null
  private isHovered = false
  private connectedThreeScene: any = null
  private keysPressed: Record<string, boolean> = {}

  private colliderBVH: MeshBVH | null = null
  private colliderVisualizer: THREE.Object3D | null = null
  private bvhHelper: BVHHelper | null = null
  private displayCollider = false
  private displayActorCollider = false
  private displayBVH = false

  private isRecording = false
  private recordingTime = 0
  private activeRecordingTargetDuration = 7.0
  private activeRecordingSpeed = 1.0
  private trajectory: Array<{ t: number; px: number; py: number; pz: number; rx: number; ry: number; rz: number }> = []

  public isPlaying = false
  private playbackController: PlaybackController

  private debugPanel: DebugPanel | null = null
  private clonedEnvGroup: THREE.Group | null = null

  private keydownHandler!: (e: KeyboardEvent) => void
  private keyupHandler!: (e: KeyboardEvent) => void
  private blurHandler!: () => void
  private resizeObserver: ResizeObserver | null = null
  private resizeAnimationFrameId: number | null = null
  private lastTime = performance.now()
  private onRecordingFinished?: (jsonString: string) => void

  constructor(options: ThreeActingOptions) {
    this.container = options.container
    this.onStateChange = options.onStateChange
    this.onRecordingFinished = options.onRecordingFinished
    this.connectedThreeScene = options.connectedThreeScene ?? null

    this.state = {
      actor_type: options.initialState?.actor_type ?? 'car',
      actor_speed: options.initialState?.actor_speed ?? 10.0,
      duration: options.initialState?.duration ?? 7.0,
      scene_data: options.initialState?.scene_data ?? { type: 'cube_scene', num_assets: 0, nodes: [] },
      motion_data: options.initialState?.motion_data
    }

    this.playbackController = new PlaybackController()

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

  public stopRecording(): string {
    this.isRecording = false
    this.isPlaying = false
    const payload = {
      type: 'acting_motion',
      actor_type: this.getActorType(),
      scene_data: this.getSceneData(),
      trajectory: this.trajectory,
      motion_data: this.trajectory
    }
    const json = JSON.stringify(payload)
    this.state.motion_data = json
    this.loadTrajectory(json)
    if (this.onStateChange) {
      this.onStateChange({ ...this.state })
    }
    return json
  }

  public getTrajectory(): Array<{ t: number; px: number; py: number; pz: number; rx: number; ry: number; rz: number }> {
    return this.trajectory
  }

  private isPlaybackMode: boolean = false

  public startPlayback(motionData?: string): void {
    if (motionData) {
      this.loadTrajectory(motionData)
    }
    if (this.playbackController.getTrajectory().length > 0) {
      this.isRecording = false
      this.isPlaybackMode = true
      this.isPlaying = true
      this.playbackController.start()
    }
  }

  public play(): void {
    if (this.playbackController.getTrajectory().length > 0) {
      this.isRecording = false
      this.isPlaybackMode = true
      this.isPlaying = true
      this.playbackController.play()
    }
  }

  public pause(): void {
    this.isPlaying = false
    this.playbackController.pause()
  }

  public stop(): void {
    this.isPlaying = false
    this.playbackController.stop()
    const trajectory = this.playbackController.getTrajectory()
    if (trajectory.length > 0) {
      this.isPlaybackMode = true
      const initialAnim = trajectory[0]?.anim
      if (this.actorController) {
        this.actorController.resetAnimation(initialAnim)
        this.playbackController.evaluateAt(0, this.actorController, 0)
      }
    } else {
      this.isPlaybackMode = false
      if (this.actorController) {
        this.actorController.resetToOrigin()
        this.actorController.resetAnimation('Idle_A')
      }
    }
  }

  public stopPlayback(): void {
    this.stop()
  }

  public getIsPlaying(): boolean {
    return this.isPlaying
  }

  public loadTrajectory(trajectoryJson: string): void {
    this.playbackController.setTrajectory(trajectoryJson)
    this.trajectory = this.playbackController.getTrajectory()
    if (this.trajectory.length > 0) {
      this.isPlaybackMode = true
    } else {
      this.isPlaybackMode = false
      if (this.actorController) {
        this.actorController.resetToOrigin()
      }
    }
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

    // Setup Stage Environment (Lights, Floor, Grid)
    const stageEnv = new StageEnvironment()
    stageEnv.initStage(this.scene)

    // Build environment and actor
    this.buildSceneEnvironment()
    this.buildActor(this.state.actor_type)

    // Initialize Debug Panel with lil-gui
    this.debugPanel = new DebugPanel(this.container)
    this.debugPanel.attachThreeActing(this)
  }

  private buildSceneEnvironment(): void {
    // 1. Cleanup old environment group if present
    if (this.clonedEnvGroup) {
      this.scene.remove(this.clonedEnvGroup)
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
    this.clonedEnvGroup = new THREE.Group()
    this.scene.add(this.clonedEnvGroup)

    let sceneData: any = this.getSceneData()
    this.state.scene_data = sceneData

    const stageEnv = new StageEnvironment()
    this.environmentMeshes = stageEnv.buildObjectsFromData(sceneData, this.clonedEnvGroup)

    // 2. Build BVH Collision Tree
    const geometries: THREE.BufferGeometry[] = []

    // Add floor box geometry to match vertex layout of boxes (centered at -0.05 height, thin box top at Y=0)
    const floorBox = new THREE.BoxGeometry(100, 0.1, 100)
    floorBox.translate(0, -0.05, 0)
    geometries.push(floorBox)

    // Force full scene graph world matrix evaluation before extracting mesh geometries
    this.scene.updateMatrixWorld(true)

    if (this.clonedEnvGroup) {
      this.clonedEnvGroup.updateMatrixWorld(true)
    }

    // Add all asset meshes geometries transformed to their world positions
    this.environmentMeshes.forEach((mesh) => {
      mesh.updateMatrixWorld(true)
      const geom = mesh.geometry.clone()
      geom.applyMatrix4(mesh.matrixWorld)
      geometries.push(geom)
    })

    if (geometries.length > 0) {
      const mergedGeom = BufferGeometryUtils.mergeGeometries(geometries)
      const newBVH = new MeshBVH(mergedGeom)
      ;(mergedGeom as any).boundsTree = newBVH
      this.colliderBVH = newBVH

      // Create collider visualizer (Green Wireframe Mesh of stage geometry)
      if (this.colliderVisualizer) {
        this.scene.remove(this.colliderVisualizer)
          ; (this.colliderVisualizer as THREE.Mesh).geometry?.dispose()
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
        ; (this.bvhHelper as any).color.set(0xffff00)
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
    const canvas = this.renderer.domElement

    canvas.addEventListener('mouseenter', () => {
      this.isHovered = true
    })
    canvas.addEventListener('mouseleave', () => {
      this.isHovered = false
      this.keysPressed = {}
    })

    this.keydownHandler = (event: KeyboardEvent) => {
      if (event.metaKey || event.code.startsWith('Meta') || event.code.startsWith('OS')) {
        this.keysPressed = {}
        return
      }

      const activeEl = document.activeElement
      if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.tagName === 'SELECT')) {
        this.keysPressed = {}
        return
      }

      const isCanvasHoveredOrFocused = this.isHovered || activeEl === this.renderer.domElement || (activeEl && this.container.contains(activeEl))
      if (!isCanvasHoveredOrFocused) {
        this.keysPressed = {}
        return
      }

      event.stopPropagation()
      event.stopImmediatePropagation()

      this.keysPressed[event.code] = true
    }

    this.keyupHandler = (event: KeyboardEvent) => {
      if (this.isHovered || this.keysPressed[event.code]) {
        event.stopPropagation()
        event.stopImmediatePropagation()
      }
      this.keysPressed[event.code] = false
    }

    this.blurHandler = () => {
      this.keysPressed = {}
    }

    window.addEventListener('keydown', this.keydownHandler, { capture: true })
    window.addEventListener('keyup', this.keyupHandler, { capture: true })
    window.addEventListener('blur', this.blurHandler)

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
    if (this.isPlaybackMode) {
      if (this.isPlaying) {
        this.playbackController.update(dt, this.actorController)
      } else if (this.actorController) {
        this.playbackController.evaluateAt(this.playbackController.getCurrentTime(), this.actorController, 0)
      }
      return
    }

    if (this.actorController) {
      const speedMult = this.state.actor_speed ?? 10.0
      this.actorController.updatePhysics(dt, this.keysPressed, speedMult, this.colliderBVH)

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

  public getSceneData(): any {
    let sceneData: any = this.state.scene_data
    if (this.connectedThreeScene) {
      if (typeof this.connectedThreeScene.getState === 'function') {
        sceneData = this.connectedThreeScene.getState()
      } else if (typeof this.connectedThreeScene.readSceneStateFromNode === 'function') {
        sceneData = this.connectedThreeScene.readSceneStateFromNode()
      }
    }
    return sceneData
  }

  public getActorType(): 'human' | 'car' {
    return this.state.actor_type ?? 'car'
  }

  public getActorController(): BaseActor {
    return this.actorController
  }

  public getState(): ActingState {
    return this.state
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
    if (this.blurHandler) {
      window.removeEventListener('blur', this.blurHandler)
    }

    if (this.debugPanel) {
      this.debugPanel.dispose()
      this.debugPanel = null
    }

    this.renderer.dispose()
    this.scene.clear()
  }
}
