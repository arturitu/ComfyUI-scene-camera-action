import * as THREE from 'three'
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js'
import { MeshBVH, BVHHelper } from 'three-mesh-bvh'
import { TransformControls } from 'three/addons/controls/TransformControls.js'
import type { ActingState, ThreeActingOptions, CubeTransform, StageState, SpawnPoint } from './types'
import * as config from './threeConfig'
import { BaseActor } from './actors/BaseActor'
import { ActorFactory } from './actors/ActorFactory'
import { DebugPanel } from './utils/DebugPanel'
import { PlaybackController } from './utils/PlaybackController'
import { StagingHierarchyManager } from './staging/StagingHierarchyManager'
import { StageEnvironment } from './staging/StageEnvironment'
import { InstancedStageMesh } from './staging/InstancedStageMesh'
import { SpawnPointHelper } from './staging/SpawnPointHelper'

const _tempCamDir = new THREE.Vector3()
const _tempRight = new THREE.Vector3()
const _tempUp = new THREE.Vector3(0, 1, 0)
const _tempOrigin = new THREE.Vector3()
const _tempOffsetDir = new THREE.Vector3()

export class ThreeActing {
  private container: HTMLElement
  private state: ActingState
  private onStateChange?: (state: ActingState) => void
  public onCameraDistanceChange?: (dist: number) => void

  private scene!: THREE.Scene
  private camera!: THREE.PerspectiveCamera
  private renderer!: THREE.WebGLRenderer
  private environmentMeshes: THREE.Mesh[] = []
  private actorController!: BaseActor
  private animationId: number | null = null
  private isHovered = false
  private isInteracting = false
  private remainingFrames = 0
  private activityStatus: 'live' | 'standby' = 'standby'
  private onActivityStatusChange?: (status: 'live' | 'standby') => void

  private connectedThreeStage: any = null
  private connectedThreeScene: any = null
  private keysPressed: Record<string, boolean> = {}
  private actingCameraTarget = new THREE.Vector3()
  private cachedSceneExtent = 15.0
  private spawnPointHelper: SpawnPointHelper | null = null
  private transformControls!: TransformControls

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
  private previousActorControllers: Array<{
    controller: BaseActor
    playbackController: PlaybackController
    record: any
  }> = []
  private previousActorsData: any[] = []
  private practiceTime: number = 0

  private debugPanel: DebugPanel | null = null
  private clonedEnvGroup: THREE.Group | null = null
  private instancedStageMesh: InstancedStageMesh | null = null
  private cameraDistance: number = 1.0
  private actingRaycaster = new THREE.Raycaster()
  private actingDitherOpacity = 1.0

  private keydownHandler!: (e: KeyboardEvent) => void
  private keyupHandler!: (e: KeyboardEvent) => void
  private blurHandler!: () => void
  private wheelHandler?: (e: WheelEvent) => void
  private resizeObserver: ResizeObserver | null = null
  private resizeAnimationFrameId: number | null = null
  private lastTime = performance.now()
  private onRecordingFinished?: (jsonString: string) => void

  constructor(options: ThreeActingOptions) {
    this.container = options.container
    this.onStateChange = options.onStateChange
    this.onRecordingFinished = options.onRecordingFinished
    this.onActivityStatusChange = options.onActivityStatusChange
    const initialStageData = options.initialState?.stage_data ?? options.initialState?.scene_data ?? { type: 'cube_stage', num_assets: 0, nodes: [] }
    this.connectedThreeStage = options.connectedThreeStage ?? options.connectedThreeScene ?? null
    const defaultSpeed = options.initialState?.actor_speed ?? (options.initialState?.actor_type === 'car' ? 20.0 : 10.0)
    this.cameraDistance = options.initialState?.camera_distance ?? 1.0

    this.state = {
      actor_type: options.initialState?.actor_type ?? 'human',
      actor_color: options.initialState?.actor_color,
      actor_speed: defaultSpeed,
      camera_distance: this.cameraDistance,
      duration: options.initialState?.duration ?? 7.0,
      stage_data: initialStageData,
      scene_data: initialStageData,
      motion_data: options.initialState?.motion_data,
      spawn_point: options.initialState?.spawn_point,
      actors: options.initialState?.actors ?? []
    }

    this.playbackController = new PlaybackController()

    this.initThreeJS()
    this.bindEvents()

    if (this.state.actors && this.state.actors.length > 0) {
      this.buildPreviousActors(this.state.actors)
    }

    if (this.state.motion_data) {
      this.loadTrajectory(this.state.motion_data)
    }

    this.renderOnce()
    this.requestFrames(10)
  }

  public setConnectedThreeStage(threeStage: any): void {
    this.connectedThreeStage = threeStage
    this.connectedThreeScene = threeStage
    this.buildStageEnvironment()
  }
  public setConnectedThreeScene(threeScene: any): void {
    this.setConnectedThreeStage(threeScene)
  }

  public startRecording(): void {
    this.trajectory = []
    this.isRecording = true
    this.isCountingCountdown = false
    this.recordingTime = 0
    this.practiceTime = 0
    this.isPlaying = false
    this.isPlaybackMode = false
    this.isInteracting = false
    this.activeRecordingTargetDuration = this.state.duration ?? 7.0
    this.activeRecordingSpeed = this.state.actor_speed ?? 1.0

    if (this.actorController) {
      this.trajectory.push(this.actorController.getMotionState(0))
    }

    this.previousActorControllers.forEach(p => {
      p.playbackController.setCurrentTime(0)
      p.playbackController.evaluateAt(0, p.controller, 0, true)
    })

    if (this.transformControls) {
      this.transformControls.detach()
    }
    if (this.spawnPointHelper) {
      this.spawnPointHelper.group.visible = false
    }
    this.startAnimationLoop()
  }

  public getAccumulatedActors(): any[] {
    const upstream = (this.previousActorsData || []).filter(
      (a: any) => !a.id?.startsWith('actor_ds_') && !a.isDownstreamPeer
    )
    const currentActorRecord = {
      id: `actor_${upstream.length + 1}`,
      actor_type: this.getActorType(),
      actor_color: this.state.actor_color || (this.getActorType() === 'human' ? '#F1DFBF' : '#0284C7'),
      actor_speed: this.state.actor_speed,
      spawn_point: this.state.spawn_point ?? { px: 0, py: 0, pz: 0, ry: 0 },
      trajectory: this.trajectory || []
    }
    return [...upstream, currentActorRecord]
  }

  public stopRecording(): string {
    this.isRecording = false
    this.isCountingCountdown = false
    this.isPlaying = false
    this.keysPressed = {}
    this.isInteracting = false
    const allActors = this.getAccumulatedActors()

    if (this.spawnPointHelper) {
      this.spawnPointHelper.group.visible = true
    }

    const payload = {
      type: 'acting_motion',
      actor_type: this.getActorType(),
      actor_color: this.state.actor_color || (this.getActorType() === 'human' ? '#F1DFBF' : '#0284C7'),
      actor_speed: this.state.actor_speed,
      duration: this.state.duration,
      spawn_point: this.state.spawn_point,
      trajectory: this.trajectory
    }
    const json = JSON.stringify(payload)
    this.state.motion_data = json
    this.state.actors = allActors

    this.playbackController.setTrajectory(JSON.stringify(this.trajectory))
    if (this.trajectory.length > 0) {
      this.isPlaybackMode = true
      this.buildPreviousActors(this.previousActorsData)
    }

    if (this.onStateChange) {
      this.onStateChange({ ...this.state, actors: allActors })
    }
    this.requestFrames(35)
    return json
  }

  public resetRecording(): void {
    this.isRecording = false
    this.isCountingCountdown = false
    this.isPlaying = false
    this.isPlaybackMode = false
    this.keysPressed = {}
    this.isInteracting = false
    this.recordingTime = 0
    this.practiceTime = 0
    this.trajectory = []
    this.playbackController.stop()
    this.playbackController.setTrajectory('')
    this.state.motion_data = undefined
    const accumulated = this.getAccumulatedActors()
    this.state.actors = accumulated
    this.resetActorPosition()
    this.buildPreviousActors(this.previousActorsData)
    if (this.onStateChange) {
      this.onStateChange({ ...this.state, motion_data: undefined, actors: accumulated })
    }
    this.requestFrames(35)
  }

  private lastBuiltPlaybackMode: boolean | null = null

  public buildPreviousActors(actorsRecords?: any[]): void {
    const newRecords = actorsRecords || []
    if (
      this.lastBuiltPlaybackMode === this.isPlaybackMode &&
      this.previousActorsData &&
      this.previousActorControllers.length === newRecords.length
    ) {
      try {
        if (JSON.stringify(newRecords) === JSON.stringify(this.previousActorsData)) {
          return
        }
      } catch (e) {}
    }
    this.lastBuiltPlaybackMode = this.isPlaybackMode

    this.previousActorControllers.forEach(p => {
      this.scene.remove(p.controller.group)
      p.controller.dispose()
    })
    this.previousActorControllers = []
    this.previousActorsData = newRecords

    this.previousActorsData.forEach((rec) => {
      let traj = rec.trajectory || rec.motion_data
      if (typeof traj === 'string' && traj.trim()) {
        try {
          const p = JSON.parse(traj)
          traj = p.trajectory || p.motion_data || p
        } catch (e) {}
      }
      if (!traj || (Array.isArray(traj) && traj.length === 0)) return

      const actorCtrl = ActorFactory.create(rec.actor_type || 'human')
      const color = rec.actor_color || (rec.actor_type === 'human' ? '#F1DFBF' : '#0284C7')
      actorCtrl.setActorColor(color)
      const pbCtrl = new PlaybackController()
      pbCtrl.setTrajectory(traj)
      pbCtrl.start()
      pbCtrl.evaluateAt(0, actorCtrl, 0, true)
      this.scene.add(actorCtrl.group)
      this.previousActorControllers.push({
        controller: actorCtrl,
        playbackController: pbCtrl,
        record: rec
      })
    })
  }

  public getPreviousActorsCount(): number {
    return this.previousActorControllers.length
  }

  public getTrajectory(): Array<{ t: number; px: number; py: number; pz: number; rx: number; ry: number; rz: number }> {
    return this.trajectory
  }

  private isPlaybackMode: boolean = false

  public startPlayback(motionData?: string): void {
    this.isRecording = false
    this.isCountingCountdown = false
    this.keysPressed = {}
    this.isInteracting = false
    if (motionData) {
      this.loadTrajectory(motionData)
    }
    if (this.playbackController.getTrajectory().length > 0) {
      this.isRecording = false
      this.isPlaybackMode = true
      this.isPlaying = true
      this.buildPreviousActors(this.previousActorsData)
      this.playbackController.start()
      this.startAnimationLoop()
    }
  }

  public play(): void {
    this.isRecording = false
    this.isCountingCountdown = false
    this.keysPressed = {}
    this.isInteracting = false
    if (this.playbackController.getTrajectory().length > 0) {
      this.isRecording = false
      this.isPlaybackMode = true
      this.isPlaying = true
      this.playbackController.play()
      this.startAnimationLoop()
    }
  }

  public pause(): void {
    this.isPlaying = false
    this.playbackController.pause()
    this.requestFrames(35)
  }

  public stop(): void {
    this.isPlaying = false
    this.playbackController.stop()
    if (this.instancedStageMesh) {
      this.instancedStageMesh.resetAllDithering()
    }
    const trajectory = this.playbackController.getTrajectory()
    if (trajectory.length > 0) {
      this.isPlaybackMode = true
      const initialAnim = trajectory[0]?.anim
      if (this.actorController) {
        this.actorController.resetAnimation(initialAnim)
        this.playbackController.evaluateAt(0, this.actorController, 0, true)
      }
    } else {
      this.isPlaybackMode = false
      if (this.actorController) {
        this.resetActorPosition()
        this.actorController.resetAnimation('Idle_A')
      }
    }
    this.requestFrames(35)
  }

  public stopPlayback(): void {
    this.stop()
  }

  public getIsPlaying(): boolean {
    return this.isPlaying
  }

  public loadTrajectory(trajectoryJson: string): void {
    if (trajectoryJson && typeof trajectoryJson === 'string' && trajectoryJson.trim()) {
      try {
        const parsed = JSON.parse(trajectoryJson)
        if (parsed && typeof parsed === 'object') {
          let localTraj = parsed.trajectory || parsed.motion_data
          if (typeof localTraj === 'string' && localTraj.trim()) {
            try { localTraj = JSON.parse(localTraj) } catch (e) {}
          }
          if (Array.isArray(localTraj)) {
            this.playbackController.setTrajectory(localTraj)
          } else if (Array.isArray(parsed.actors) && parsed.actors.length > 0) {
            const lastActor = parsed.actors[parsed.actors.length - 1]
            const lastTraj = lastActor?.trajectory || lastActor?.motion_data
            this.playbackController.setTrajectory(lastTraj || [])
          } else {
            this.playbackController.setTrajectory(trajectoryJson)
          }

          if (Array.isArray(parsed.actors) && parsed.actors.length > 0) {
            const prevActors = parsed.actors.length > 1 ? parsed.actors.slice(0, parsed.actors.length - 1) : []
            this.buildPreviousActors(prevActors)
          }
          this.trajectory = this.playbackController.getTrajectory()

          if (this.trajectory.length > 0) {
            this.isPlaybackMode = true
          } else {
            this.isPlaybackMode = false
            if (this.actorController) {
              this.resetActorPosition()
            }
          }
          return
        }
      } catch (e) {
        console.warn('[ThreeActing] Error parsing actors array from trajectoryJson:', e)
      }
    }

    this.playbackController.setTrajectory(trajectoryJson)
    this.trajectory = this.playbackController.getTrajectory()

    if (this.trajectory.length > 0) {
      this.isPlaybackMode = true
    } else {
      this.isPlaybackMode = false
      if (this.actorController) {
        this.resetActorPosition()
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
    this.camera.position.set(-8, 4, 0)
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
    canvas.style.cursor = 'default'
    canvas.addEventListener('webglcontextlost', (event: Event) => {
      event.preventDefault()
      if (this.animationId !== null) {
        cancelAnimationFrame(this.animationId)
        this.animationId = null
      }
    }, false)

    // Setup Stage Environment (Lights, Floor, Grid)
    const stageEnv = new StageEnvironment()
    stageEnv.initStage(this.scene)

    // Build environment and actor
    this.buildStageEnvironment()
    this.buildActor(this.state.actor_type)

    // Setup Spawn Point Helper & Transform Controls
    this.spawnPointHelper = new SpawnPointHelper()
    const initialSp = this.state.spawn_point ?? { px: 0, py: 0, pz: 0, ry: 0 }
    this.state.spawn_point = initialSp
    this.spawnPointHelper.setSpawnPoint(initialSp)
    this.scene.add(this.spawnPointHelper.group)

    this.transformControls = new TransformControls(this.camera, this.renderer.domElement)
    this.transformControls.size = 1.8
    this.transformControls.enabled = false
    this.transformControls.detach()
    this.scene.add(this.transformControls.getHelper())

    this.transformControls.addEventListener('change', () => {
      this.requestFrames(2)
    })

    this.transformControls.addEventListener('dragging-changed', (event: any) => {
      this.isInteracting = !!event.value
      if (event.value) {
        this.startAnimationLoop()
      } else {
        this.requestFrames(35)
      }

      if (!event.value) {
        if (this.spawnPointHelper && this.actorController) {
          const sp = this.spawnPointHelper.getSpawnPoint()
          this.state.spawn_point = sp
          this.actorController.resetToOrigin(sp)
          if (this.onStateChange) {
            this.onStateChange({ ...this.state })
          }
        }
      }
    })

    this.transformControls.addEventListener('objectChange', () => {
      if (this.spawnPointHelper && this.actorController) {
        const sp = this.spawnPointHelper.getSpawnPoint()
        this.state.spawn_point = sp
        // Fast visual sync (X, Y height, Z, and Y-rotation) during active drag
        this.actorController.group.position.set(sp.px, sp.py, sp.pz)
        this.actorController.group.rotation.y = sp.ry
      }
      this.requestFrames(10)
    })

    // Initialize Debug Panel with lil-gui
    this.debugPanel = new DebugPanel(this.container)
    this.debugPanel.attachThreeActing(this)
  }

  private buildActor(type?: 'human' | 'car'): void {
    const charType = type ?? this.state.actor_type ?? 'human'
    if (this.actorController) {
      this.scene.remove(this.actorController.group)
      this.actorController.dispose()
    }
    this.actorController = ActorFactory.create(charType)
    const color = this.state.actor_color || (charType === 'human' ? '#F1DFBF' : '#0284C7')
    this.actorController.setActorColor(color)
    this.actorController.setDisplayCollider(this.displayActorCollider)
    this.scene.add(this.actorController.group)
    this.resetActorPosition()
  }

  public setActorColor(color: string, triggerChange: boolean = true): void {
    const isDifferent = this.state.actor_color !== color
    this.state.actor_color = color
    if (this.actorController) {
      this.actorController.setActorColor(color)
    }
    if (isDifferent && triggerChange && this.onStateChange) {
      this.onStateChange({ ...this.state, actor_color: color, actors: this.getAccumulatedActors() })
    }
  }

  public setCameraDistance(dist: number): void {
    this.cameraDistance = Math.max(0.5, Math.min(2.5, Math.round(dist * 10) / 10))
    this.state.camera_distance = this.cameraDistance
  }

  public getCameraDistance(): number {
    return this.cameraDistance
  }

  private getActorFramingOffsets(): { camOffset: THREE.Vector3; targetOffset: THREE.Vector3 } {
    if (!this.actorController) {
      return { camOffset: new THREE.Vector3(-8 * this.cameraDistance, 4 * this.cameraDistance, 0), targetOffset: new THREE.Vector3(0, 0.5, 0) }
    }

    const bbox = new THREE.Box3().setFromObject(this.actorController.group)
    const size = new THREE.Vector3()
    bbox.getSize(size)

    const maxSpan = Math.max(size.x, size.y, size.z, 1.5)
    const dist = Math.max(8.0, maxSpan * 2.8) * this.cameraDistance
    const camX = -dist * 0.85
    const camY = Math.max(2.5, dist * 0.45)
    const targetY = size.y > 0 ? Math.max(0.5, size.y * 0.45) : 0.5

    return {
      camOffset: new THREE.Vector3(camX, camY, 0),
      targetOffset: new THREE.Vector3(0, targetY, 0)
    }
  }

  public setSpawnTransformMode(mode: 'translate' | 'rotate' | null): void {
    if (!this.transformControls || !this.spawnPointHelper) return
    if (this.transformControls.object === this.spawnPointHelper.group && this.transformControls.mode === mode) {
      this.transformControls.enabled = false
      this.transformControls.detach()
      return
    }
    if (mode === 'translate') {
      this.transformControls.enabled = true
      this.transformControls.setMode('translate')
      this.transformControls.showX = true
      this.transformControls.showY = true
      this.transformControls.showZ = true
      this.transformControls.attach(this.spawnPointHelper.group)
    } else if (mode === 'rotate') {
      this.transformControls.enabled = true
      this.transformControls.setMode('rotate')
      this.transformControls.showX = false
      this.transformControls.showY = true
      this.transformControls.showZ = false
      this.transformControls.attach(this.spawnPointHelper.group)
    } else {
      this.transformControls.enabled = false
      this.transformControls.detach()
    }
  }

  public getSpawnTransformMode(): 'translate' | 'rotate' | null {
    if (!this.transformControls || !this.transformControls.object) return null
    return this.transformControls.mode as 'translate' | 'rotate'
  }

  public resetActorPosition(): void {
    if (this.actorController) {
      const sp = this.state.spawn_point ?? { px: 0, py: 0, pz: 0, ry: 0 }
      this.actorController.resetToOrigin(sp)
      if (this.spawnPointHelper) {
        this.spawnPointHelper.setSpawnPoint(sp)
        if (!this.isRecording) {
          this.spawnPointHelper.group.visible = true
        }
      }

      // Immediately set camera view dynamically targeting actor size and spawn position
      const pos = this.actorController.position
      const { camOffset, targetOffset } = this.getActorFramingOffsets()
      this.camera.position.set(pos.x + camOffset.x, pos.y + camOffset.y, pos.z + camOffset.z)
      this.actingCameraTarget.set(pos.x + targetOffset.x, pos.y + targetOffset.y, pos.z + targetOffset.z)
      this.camera.lookAt(this.actingCameraTarget)
      if (this.instancedStageMesh) {
        this.instancedStageMesh.resetAllDithering()
      }
    }
  }

  public onNodePointerEnter(): void {
    this.isHovered = true
    this.startAnimationLoop()
  }

  public onNodePointerLeave(): void {
    this.isHovered = false
    this.keysPressed = {}
    this.isInteracting = false
    this.requestFrames(35)
  }

  private bindEvents(): void {
    const canvas = this.renderer.domElement

    canvas.addEventListener('pointerdown', () => {
      this.isInteracting = true
      this.startAnimationLoop()
    })
    window.addEventListener('pointerup', () => {
      this.isInteracting = false
    })
    canvas.addEventListener('webglcontextlost', (event: Event) => {
      event.preventDefault()
      this.stopAnimationLoop()
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
      this.startAnimationLoop()
    }

    this.keyupHandler = (event: KeyboardEvent) => {
      if (this.isHovered || this.keysPressed[event.code]) {
        event.stopPropagation()
        event.stopImmediatePropagation()
      }
      this.keysPressed[event.code] = false
      this.requestFrames(35)
    }

    this.blurHandler = () => {
      this.keysPressed = {}
      this.requestFrames(35)
    }

    window.addEventListener('keydown', this.keydownHandler, { capture: true })
    window.addEventListener('keyup', this.keyupHandler, { capture: true })
    window.addEventListener('blur', this.blurHandler)

    this.wheelHandler = (event: WheelEvent) => {
      if (!this.isHovered) return
      event.preventDefault()
      event.stopPropagation()
      const delta = event.deltaY > 0 ? 0.1 : -0.1
      const newDist = Math.max(0.5, Math.min(2.5, Math.round((this.cameraDistance + delta) * 10) / 10))
      this.setCameraDistance(newDist)
      if (this.onCameraDistanceChange) {
        this.onCameraDistanceChange(newDist)
      }
      if (this.onStateChange) {
        this.onStateChange({ ...this.state, camera_distance: newDist, actors: this.getAccumulatedActors() })
      }
      this.requestFrames(25)
    }
    canvas.addEventListener('wheel', this.wheelHandler, { passive: false })

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
      const curTime = this.playbackController.getCurrentTime()
      this.previousActorControllers.forEach(p => {
        p.playbackController.evaluateAt(curTime, p.controller, this.isPlaying ? dt : 0)
      })
      if (this.isPlaying) {
        this.playbackController.update(dt, this.actorController)
        if (this.playbackController.isEnded()) {
          this.isPlaying = false
          if (this.actorController) {
            const trajectory = this.playbackController.getTrajectory()
            const finalAnim = trajectory[trajectory.length - 1]?.anim || 'Idle_A'
            this.actorController.resetAnimation(finalAnim)
          }
        }
      } else if (this.actorController) {
        this.playbackController.evaluateAt(curTime, this.actorController, 0)
      }
      return
    }

    // --- Active Countdown Mode (3, 2, 1...) ---
    if (this.isCountingCountdown) {
      this.previousActorControllers.forEach(p => {
        p.playbackController.evaluateAt(0, p.controller, 0, true)
      })
      if (this.actorController) {
        const speedMult = this.state.actor_speed ?? 10.0
        this.actorController.updatePhysics(dt, this.keysPressed, speedMult, this.colliderBVH, this.camera)
      }
      return
    }

    // --- Active Recording Mode ---
    if (this.isRecording) {
      this.previousActorControllers.forEach(p => {
        p.playbackController.evaluateAt(this.recordingTime, p.controller, dt)
      })

      if (this.actorController) {
        const speedMult = this.activeRecordingSpeed || (this.state.actor_speed ?? 10.0)
        this.actorController.updatePhysics(dt, this.keysPressed, speedMult, this.colliderBVH, this.camera)

        this.trajectory.push(this.actorController.getMotionState(this.recordingTime))
        this.recordingTime += dt

        if (this.recordingTime >= this.activeRecordingTargetDuration) {
          const json = this.stopRecording()
          if (this.onRecordingFinished) {
            this.onRecordingFinished(json)
          }
        }
      }
      return
    }

    // --- Continuous Looping Practice Mode ---
    const loopDuration = Math.max(0.1, this.state.duration ?? 7.0)
    this.practiceTime = (this.practiceTime + dt) % loopDuration
    this.previousActorControllers.forEach(p => {
      p.playbackController.evaluateAt(this.practiceTime, p.controller, dt)
    })

    if (this.actorController) {
      const speedMult = this.state.actor_speed ?? 10.0
      this.actorController.updatePhysics(dt, this.keysPressed, speedMult, this.colliderBVH, this.camera)
    }
  }

  public getPracticeTime(): number {
    if (this.isCountingCountdown) return 0
    const loopDur = Math.max(0.1, this.state.duration ?? 7.0)
    return this.practiceTime % loopDur
  }

  public isPracticeMode(): boolean {
    return !this.isRecording && !this.isPlaybackMode
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

  private onResize(): void {
    const w = this.container.clientWidth
    const h = this.container.clientHeight
    if (w === 0 || h === 0) return

    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(w, h, false)
    this.renderOnce()
  }

  private isCountingCountdown: boolean = false

  public setCountingState(counting: boolean): void {
    this.isCountingCountdown = counting
    if (counting) {
      this.practiceTime = 0
      this.recordingTime = 0
      if (this.spawnPointHelper) {
        this.spawnPointHelper.group.visible = false
      }
      if (this.transformControls) {
        this.transformControls.detach()
      }
      this.resetActorPosition()
      this.previousActorControllers.forEach(p => {
        p.playbackController.setCurrentTime(0)
        p.playbackController.evaluateAt(0, p.controller, 0, true)
      })
      this.startAnimationLoop()
    } else {
      this.requestFrames(35)
    }
  }

  private setActivityStatus(status: 'live' | 'standby'): void {
    if (this.activityStatus !== status) {
      this.activityStatus = status
      this.onActivityStatusChange?.(status)
    }
  }

  public renderOnce(): void {
    this.renderFrame(0.016)
  }

  public requestFrames(count: number = 30): void {
    this.remainingFrames = Math.max(this.remainingFrames, count)
    if (this.animationId === null) {
      this.lastTime = performance.now()
      this.animationId = requestAnimationFrame(() => this.animate())
    }
  }

  public startAnimationLoop(): void {
    this.setActivityStatus('live')
    if (this.animationId === null) {
      this.lastTime = performance.now()
      this.animationId = requestAnimationFrame(() => this.animate())
    }
  }

  public stopAnimationLoop(): void {
    if (this.animationId !== null) {
      cancelAnimationFrame(this.animationId)
      this.animationId = null
    }
    this.setActivityStatus('standby')
  }

  private renderFrame(dt: number): void {
    if (this.spawnPointHelper) {
      const shouldBeVisible = !this.isPlaying && !this.isRecording && !this.isCountingCountdown
      if (this.spawnPointHelper.group.visible !== shouldBeVisible) {
        this.spawnPointHelper.group.visible = shouldBeVisible
        if (!shouldBeVisible && this.transformControls) {
          this.transformControls.detach()
        }
      }
    }

    this.updateActorMovement(dt)

    // Camera following actor with dynamic framing lerp without SpringArm push, and with Dithering for occluding obstacles
    if (this.actorController) {
      const pos = this.actorController.position
      const { camOffset, targetOffset } = this.getActorFramingOffsets()
      const idealCamPos = new THREE.Vector3(pos.x + camOffset.x, pos.y + camOffset.y, pos.z + camOffset.z)
      const idealTarget = new THREE.Vector3(pos.x + targetOffset.x, pos.y + targetOffset.y, pos.z + targetOffset.z)

      this.camera.position.lerp(idealCamPos, 0.12)
      this.actingCameraTarget.lerp(idealTarget, 0.12)
      this.camera.lookAt(this.actingCameraTarget)

      if (this.instancedStageMesh) {
        const camPos = this.camera.position
        const targetPos = this.actingCameraTarget
        const distToTarget = camPos.distanceTo(targetPos)

        const occludedSet = new Set<number>()

        if (distToTarget > 0.1) {
          _tempCamDir.subVectors(targetPos, camPos).normalize()
          _tempRight.crossVectors(_tempCamDir, _tempUp).normalize()
          const r = 0.28
          const probeOffsets = [
            new THREE.Vector3(0, 0, 0),
            _tempRight.clone().multiplyScalar(r),
            _tempRight.clone().multiplyScalar(-r),
            new THREE.Vector3(0, r * 0.7, 0),
            new THREE.Vector3(0, -r * 0.7, 0)
          ]

          for (const offset of probeOffsets) {
            const origin = _tempOrigin.copy(camPos).add(offset)
            const dir = _tempOffsetDir.subVectors(targetPos, origin).normalize()
            this.actingRaycaster.set(origin, dir)
            this.actingRaycaster.near = 0.1
            this.actingRaycaster.far = Math.max(0.2, distToTarget - 0.45)

            const hits = this.actingRaycaster.intersectObject(this.instancedStageMesh.getSurfaceMesh(), false)
            for (const hit of hits) {
              if (hit.instanceId !== undefined && hit.instanceId !== null) {
                occludedSet.add(hit.instanceId)
              }
            }
          }
        }

        this.instancedStageMesh.setOccludedInstances(occludedSet, 0.15)
        this.instancedStageMesh.updateDither(dt)
      }
    }

    config.updateSceneFog(this.scene, this.camera, this.cachedSceneExtent, this.actingCameraTarget)

    this.renderer.render(this.scene, this.camera)
  }

  private animate(): void {
    const time = performance.now()
    const dt = Math.min((time - this.lastTime) / 1000, 0.1)
    this.lastTime = time

    this.renderFrame(dt)

    if (this.remainingFrames > 0) {
      this.remainingFrames--
    }

    const hasKeys = this.isHovered && Object.values(this.keysPressed).some(Boolean)
    const isTransforming = !!(this.transformControls && (this.transformControls as any).dragging)
    const isActivelyEngaged = this.isRecording || this.isCountingCountdown || this.isHovered || this.isInteracting || isTransforming || hasKeys

    if (isActivelyEngaged) {
      this.setActivityStatus('live')
    } else {
      this.setActivityStatus('standby')
    }

    const shouldContinue = isActivelyEngaged || this.remainingFrames > 0

    if (shouldContinue) {
      this.animationId = requestAnimationFrame(() => this.animate())
    } else {
      this.stopAnimationLoop()
    }
  }

  public setStageData(stageData: StageState): void {
    this.state.stage_data = { ...stageData }
    this.state.scene_data = { ...stageData }
    this.buildStageEnvironment()
    this.renderOnce()
  }
  public setSceneData(sceneData: StageState): void {
    this.setStageData(sceneData)
  }

  public setState(newState: Partial<ActingState>): void {
    if (newState.actors !== undefined) {
      this.buildPreviousActors(newState.actors)
      this.state.actors = this.getAccumulatedActors()
    }
    if (newState.actor_type !== undefined && newState.actor_type !== this.state.actor_type) {
      this.state.actor_type = newState.actor_type
      this.buildActor(newState.actor_type)
    }
    if (newState.actor_color !== undefined) {
      this.setActorColor(newState.actor_color, false)
    }
    if (newState.actor_speed !== undefined) {
      this.state.actor_speed = newState.actor_speed
    }
    if (newState.camera_distance !== undefined) {
      this.setCameraDistance(newState.camera_distance)
    }
    if (newState.duration !== undefined) {
      if (this.state.duration !== undefined && this.state.duration !== newState.duration && this.trajectory.length > 0) {
        this.resetRecording()
      }
      this.state.duration = newState.duration
    }
    if (newState.motion_data !== undefined) {
      this.state.motion_data = newState.motion_data
      if (!newState.motion_data || (typeof newState.motion_data === 'string' && !newState.motion_data.trim())) {
        this.trajectory = []
        this.isPlaybackMode = false
        this.playbackController.setTrajectory('')
      } else {
        this.loadTrajectory(newState.motion_data)
      }
    }
    const newStageData = newState.stage_data ?? newState.scene_data
    if (newStageData !== undefined) {
      this.state.stage_data = { ...newStageData }
      this.state.scene_data = { ...newStageData }
      this.buildStageEnvironment()
    }
    this.renderOnce()
  }

  public buildStageEnvironment(): void {
    if (this.clonedEnvGroup) {
      this.scene.remove(this.clonedEnvGroup)
    }

    this.environmentMeshes = []
    this.clonedEnvGroup = new THREE.Group()
    this.clonedEnvGroup.name = 'ClonedStagingEnvironment'
    this.scene.add(this.clonedEnvGroup)

    let stageData: any = this.getStageData()
    this.state.stage_data = stageData
    this.state.scene_data = stageData

    const stageEnv = new StageEnvironment()
    const instancedStage = stageEnv.buildInstancedStage(stageData, this.clonedEnvGroup)
    this.instancedStageMesh = instancedStage
    this.environmentMeshes = [instancedStage.getSurfaceMesh()]

    this.cachedSceneExtent = config.calculateStageExtent(this.clonedEnvGroup)
    config.updateStageFog(this.scene, this.camera, this.cachedSceneExtent, this.actingCameraTarget)

    // Build BVH Collision Tree
    const mergedGeom = instancedStage.getMergedColliderGeometry(true)

    if (mergedGeom) {
      const newBVH = new MeshBVH(mergedGeom)
      ;(mergedGeom as any).boundsTree = newBVH
      this.colliderBVH = newBVH

      if (this.colliderVisualizer) {
        this.scene.remove(this.colliderVisualizer)
        ;(this.colliderVisualizer as THREE.Mesh).geometry?.dispose()
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
    } else {
      this.colliderBVH = null
    }

    if (this.actorController && !this.isPlaying && !this.isRecording) {
      this.resetActorPosition()
    }
  }
  public buildSceneEnvironment(): void {
    this.buildStageEnvironment()
  }

  public getStageData(): any {
    let stageData: any = this.state.stage_data ?? this.state.scene_data
    const conn = this.connectedThreeStage ?? this.connectedThreeScene
    if (conn) {
      if (typeof conn.getState === 'function') {
        stageData = conn.getState()
      } else if (typeof conn.readSceneStateFromNode === 'function') {
        stageData = conn.readSceneStateFromNode()
      } else if (typeof conn.readStageStateFromNode === 'function') {
        stageData = conn.readStageStateFromNode()
      }
    }
    return stageData
  }
  public getSceneData(): any {
    return this.getStageData()
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

  public getActorType(): 'human' | 'car' {
    return this.state.actor_type ?? 'car'
  }

  public getActorController(): BaseActor {
    return this.actorController
  }

  public getState(): ActingState {
    const accumulated = this.getAccumulatedActors()
    this.state.actors = accumulated
    return {
      ...this.state,
      actors: accumulated
    }
  }

  public getScene(): THREE.Scene {
    return this.scene
  }

  public dispose(): void {
    if (this.spawnPointHelper) {
      this.spawnPointHelper.dispose()
    }

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
    if (this.wheelHandler && this.renderer?.domElement) {
      this.renderer.domElement.removeEventListener('wheel', this.wheelHandler)
    }

    if (this.debugPanel) {
      this.debugPanel.dispose()
      this.debugPanel = null
    }

    if (this.renderer) {
      this.renderer.dispose()
      this.renderer.forceContextLoss()
      if (this.renderer.domElement && this.renderer.domElement.parentElement) {
        this.renderer.domElement.remove()
      }
    }
    this.scene.clear()
  }
}
