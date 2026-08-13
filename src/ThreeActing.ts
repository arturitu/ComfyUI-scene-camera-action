import * as THREE from 'three'
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js'
import { MeshBVH, BVHHelper } from 'three-mesh-bvh'
import type { ActingState, ThreeActingOptions, CubeTransform, StageState } from './types'
import * as config from './threeConfig'
import { BaseActor } from './actors/BaseActor'
import { ActorFactory } from './actors/ActorFactory'
import { DebugPanel } from './utils/DebugPanel'
import { PlaybackController } from './utils/PlaybackController'
import { StagingHierarchyManager } from './staging/StagingHierarchyManager'
import { StageEnvironment } from './staging/StageEnvironment'
import { SpawnPointHelper } from './staging/SpawnPointHelper'

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
  private connectedThreeStage: any = null
  private connectedThreeScene: any = null
  private keysPressed: Record<string, boolean> = {}
  private actingCameraTarget = new THREE.Vector3()
  private cachedSceneExtent = 15.0
  private spawnPointHelper: SpawnPointHelper | null = null

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
    const initialStageData = options.initialState?.stage_data ?? options.initialState?.scene_data ?? { type: 'cube_stage', num_assets: 0, nodes: [] }
    this.connectedThreeStage = options.connectedThreeStage ?? options.connectedThreeScene ?? null
    this.connectedThreeScene = this.connectedThreeStage

    this.state = {
      actor_type: options.initialState?.actor_type ?? 'car',
      actor_speed: options.initialState?.actor_speed ?? 10.0,
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

    this.animate()
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
    this.recordingTime = 0
    this.isPlaying = false
    this.activeRecordingTargetDuration = this.state.duration ?? 7.0
    this.activeRecordingSpeed = this.state.actor_speed ?? 1.0

    // Reset previous actors to t=0
    this.previousActorControllers.forEach(p => {
      p.playbackController.start()
      p.playbackController.evaluateAt(0, p.controller, 0)
    })
  }

  public getAccumulatedActors(): any[] {
    const upstream = this.previousActorsData || []
    if (this.trajectory && this.trajectory.length > 0) {
      const currentActorRecord = {
        id: `actor_${upstream.length + 1}`,
        actor_type: this.getActorType(),
        actor_speed: this.state.actor_speed,
        spawn_point: this.state.spawn_point,
        trajectory: this.trajectory
      }
      return [...upstream, currentActorRecord]
    }
    return [...upstream]
  }

  public stopRecording(): string {
    this.isRecording = false
    this.isPlaying = false
    const stageData = this.getStageData()
    const allActors = this.getAccumulatedActors()

    const payload = {
      type: 'acting_motion',
      actor_type: this.getActorType(),
      stage_data: stageData,
      scene_data: stageData,
      trajectory: this.trajectory,
      motion_data: this.trajectory,
      actors: allActors
    }
    const json = JSON.stringify(payload)
    this.state.motion_data = json
    this.state.actors = allActors
    this.playbackController.setTrajectory(JSON.stringify(this.trajectory))
    if (this.trajectory.length > 0) {
      this.isPlaybackMode = true
    }

    if (this.onStateChange) {
      this.onStateChange({ ...this.state, actors: allActors })
    }
    return json
  }

  public buildPreviousActors(actorsRecords: any[]): void {
    const newRecords = actorsRecords || []
    if (this.previousActorsData && this.previousActorControllers.length === newRecords.length) {
      try {
        if (JSON.stringify(newRecords) === JSON.stringify(this.previousActorsData)) {
          return
        }
      } catch (e) {}
    }

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
        this.resetActorPosition()
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

    if (trajectoryJson && typeof trajectoryJson === 'string' && trajectoryJson.trim()) {
      try {
        const parsed = JSON.parse(trajectoryJson)
        if (parsed && Array.isArray(parsed.actors) && parsed.actors.length > 0) {
          let prevActors = parsed.actors
          if (this.trajectory.length > 0 && parsed.actors.length > 1) {
            prevActors = parsed.actors.slice(0, parsed.actors.length - 1)
          } else if (this.trajectory.length > 0 && parsed.actors.length === 1) {
            prevActors = []
          }
          this.buildPreviousActors(prevActors)
        }
      } catch (e) {
        console.warn('[ThreeActing] Error parsing actors array from trajectoryJson:', e)
      }
    }

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
    this.actorController.setDisplayCollider(this.displayActorCollider)
    this.scene.add(this.actorController.group)
    this.resetActorPosition()
  }

  public resetActorPosition(): void {
    if (this.actorController) {
      const sceneData = this.getSceneData()
      this.actorController.resetToOrigin(sceneData?.spawn_point)

      // Immediately set camera view targeting actor spawn position
      const pos = this.actorController.position
      this.camera.position.set(pos.x - 8, pos.y + 4, pos.z)
      this.actingCameraTarget.set(pos.x, pos.y + 0.5, pos.z)
      this.camera.lookAt(this.actingCameraTarget)
    }
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
    // Evaluate previous actors' motion at current playback/recording time
    const curTime = this.getCurrentTime()
    this.previousActorControllers.forEach(p => {
      p.playbackController.evaluateAt(curTime, p.controller, dt)
    })

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
      this.actorController.updatePhysics(dt, this.keysPressed, speedMult, this.colliderBVH, this.camera)

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

    // Camera following actor with smooth lerp
    if (this.actorController) {
      const pos = this.actorController.position
      const idealCamPos = new THREE.Vector3(pos.x - 8, pos.y + 4, pos.z)
      const idealTarget = new THREE.Vector3(pos.x, pos.y + 0.5, pos.z)

      this.camera.position.lerp(idealCamPos, 0.12)
      this.actingCameraTarget.lerp(idealTarget, 0.12)
      this.camera.lookAt(this.actingCameraTarget)
    }

    config.updateSceneFog(this.scene, this.camera, this.cachedSceneExtent, this.actingCameraTarget)

    this.renderer.render(this.scene, this.camera)
  }

  public setStageData(stageData: StageState): void {
    this.state.stage_data = { ...stageData }
    this.state.scene_data = { ...stageData }
    this.buildStageEnvironment()
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
    const newStageData = newState.stage_data ?? newState.scene_data
    if (newStageData !== undefined) {
      this.state.stage_data = { ...newStageData }
      this.state.scene_data = { ...newStageData }
      this.buildStageEnvironment()
    }
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
    this.environmentMeshes = stageEnv.buildObjectsFromData(stageData, this.clonedEnvGroup)

    this.cachedSceneExtent = config.calculateStageExtent(this.clonedEnvGroup)
    config.updateStageFog(this.scene, this.camera, this.cachedSceneExtent, this.actingCameraTarget)

    // Build BVH Collision Tree
    const geometries: THREE.BufferGeometry[] = []

    const floorBox = new THREE.BoxGeometry(100, 0.1, 100)
    floorBox.translate(0, -0.05, 0)
    geometries.push(floorBox)

    this.scene.updateMatrixWorld(true)
    if (this.clonedEnvGroup) {
      this.clonedEnvGroup.updateMatrixWorld(true)
    }

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

      geometries.forEach(g => g.dispose())
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
