import * as THREE from 'three'
import type { DirectingState, ThreeDirectingOptions } from './types'
import * as config from './threeConfig'
import { BaseActor } from './actors/BaseActor'
import { ActorFactory } from './actors/ActorFactory'
import { PlaybackController } from './utils/PlaybackController'
import { StageEnvironment } from './scene/StageEnvironment'

export class ThreeDirecting {
  private container: HTMLElement
  private state: DirectingState
  private onStateChange?: (state: DirectingState) => void

  private scene!: THREE.Scene
  private camera!: THREE.PerspectiveCamera
  private renderer!: THREE.WebGLRenderer
  private actorController: BaseActor | null = null
  private animationId: number | null = null
  private clonedEnvGroup: THREE.Group | null = null
  private connectedThreeActing: any = null

  private playbackController = new PlaybackController()
  private actorPosition = new THREE.Vector3(0, config.GROUND_Y, 2)
  private wideTarget = new THREE.Vector3(0, 0, 0)
  private lastTime = performance.now()
  private resizeObserver: ResizeObserver | null = null
  private resizeAnimationFrameId: number | null = null

  constructor(options: ThreeDirectingOptions) {
    this.container = options.container
    this.onStateChange = options.onStateChange
    this.state = {
      camera_mode: options.initialState?.camera_mode ?? 'Third Person',
      acting_data: options.initialState?.acting_data ?? '',
      directing_data: options.initialState?.directing_data ?? '',
    }

    this.initThreeJS()

    if (this.state.acting_data) {
      this.loadActingData(this.state.acting_data)
    }

    this.animate()
  }

  public setConnectedThreeActing(threeActing: any): void {
    this.connectedThreeActing = threeActing
    const actorType = (this.connectedThreeActing && typeof this.connectedThreeActing.getActorType === 'function')
      ? this.connectedThreeActing.getActorType()
      : (this.connectedThreeActing && typeof this.connectedThreeActing.getState === 'function')
        ? this.connectedThreeActing.getState()?.actor_type
        : undefined
    this.buildActor(actorType)
    this.buildSceneEnvironment()
  }

  public loadActingData(actingDataJson: string): void {
    console.log('[ThreeDirecting] loadActingData called, payload length:', actingDataJson?.length ?? 0)
    let parsedActorType: string | undefined
    if (actingDataJson && actingDataJson.trim()) {
      try {
        const parsed = JSON.parse(actingDataJson)
        if (typeof parsed === 'object' && parsed !== null) {
          parsedActorType = parsed.actor_type || parsed.actorType || parsed.char_type
          console.log('[ThreeDirecting] Parsed actor_type:', parsedActorType)
          if (parsed.scene_data && !this.connectedThreeActing) {
            this.buildSceneFromData(parsed.scene_data)
          }
        }
      } catch (e) {
        console.warn('[ThreeDirecting] JSON parse error in loadActingData:', e)
      }
      this.playbackController.setTrajectory(actingDataJson)
      this.playbackController.start()
    }

    this.buildSceneEnvironment()
    this.buildActor(parsedActorType)

    if (this.actorController) {
      if (this.playbackController.getTrajectory().length > 0) {
        this.playbackController.evaluateAt(0, this.actorController)
      }
      this.actorPosition.copy(this.actorController.position)
    }
    this.updateCamera()
  }

  private normalizeTrajectoryOrientation(): void {
    const trajectory = this.playbackController.getTrajectory()
    if (trajectory.length < 2) return

    let firstMoveIdx = -1
    for (let i = 1; i < trajectory.length; i++) {
      const dx = trajectory[i].px - trajectory[0].px
      const dz = trajectory[i].pz - trajectory[0].pz
      if (dx * dx + dz * dz > 0.001 || Math.abs(trajectory[i].ry - trajectory[0].ry) > 0.001) {
        firstMoveIdx = i
        break
      }
    }

    if (firstMoveIdx > 0) {
      const dx = trajectory[firstMoveIdx].px - trajectory[0].px
      const dz = trajectory[firstMoveIdx].pz - trajectory[0].pz
      let initialRy = trajectory[firstMoveIdx].ry
      if (dx * dx + dz * dz > 0.001) {
        initialRy = Math.atan2(dx, dz)
      }
      for (let k = 0; k < firstMoveIdx; k++) {
        trajectory[k].ry = initialRy
      }
    }
  }

  private initThreeJS(): void {
    const width = this.container.clientWidth || 400
    const height = this.container.clientHeight || 350

    this.scene = new THREE.Scene()
    const bgColor = new THREE.Color(config.BACKGROUND_COLOR)
    this.scene.background = bgColor
    this.scene.fog = new THREE.Fog(bgColor, config.FOG_NEAR, config.FOG_FAR)

    this.camera = new THREE.PerspectiveCamera(50, width / height, config.CAMERA_NEAR, config.CAMERA_FAR)
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
    const stageSetup = stageEnv.initStage(this.scene)

    this.buildSceneEnvironment()
    this.buildActor()

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

  public getSceneData(): any {
    let actingPayload: any = this.state.acting_data
    if (typeof actingPayload === 'string') {
      try { actingPayload = JSON.parse(actingPayload) } catch (e) { }
    }
    if (actingPayload?.scene_data) {
      return actingPayload.scene_data
    }
    if (this.connectedThreeActing) {
      if (typeof this.connectedThreeActing.getSceneData === 'function') {
        return this.connectedThreeActing.getSceneData()
      }
      if (typeof this.connectedThreeActing.getState === 'function') {
        const actingState = this.connectedThreeActing.getState()
        if (actingState?.scene_data) return actingState.scene_data
      }
    }
    return undefined
  }

  private buildSceneEnvironment(): void {
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

    this.clonedEnvGroup = new THREE.Group()
    this.scene.add(this.clonedEnvGroup)

    const sceneData = this.getSceneData()

    const stageEnv = new StageEnvironment()
    stageEnv.buildObjectsFromData(sceneData, this.clonedEnvGroup)

    this.buildActor()
  }

  private buildSceneFromData(sceneData: any): void {
    let actingPayload: any = this.state.acting_data
    if (typeof actingPayload === 'string') {
      try { actingPayload = JSON.parse(actingPayload) } catch (e) { }
    }
    if (!actingPayload || typeof actingPayload !== 'object') {
      actingPayload = {}
    }
    actingPayload.scene_data = sceneData
    this.state.acting_data = actingPayload
    this.buildSceneEnvironment()
  }

  private buildActor(type?: string): void {
    let charType = type
    if (!charType) {
      let actingPayload: any = this.state.acting_data
      if (typeof actingPayload === 'string') {
        try { actingPayload = JSON.parse(actingPayload) } catch (e) { }
      }
      charType = actingPayload?.actor_type || actingPayload?.actorType || actingPayload?.char_type
    }
    if (!charType && this.connectedThreeActing) {
      if (typeof this.connectedThreeActing.getActorType === 'function') {
        charType = this.connectedThreeActing.getActorType()
      } else if (typeof this.connectedThreeActing.getState === 'function') {
        charType = this.connectedThreeActing.getState()?.actor_type
      }
    }
    if (!charType) {
      charType = 'car'
    }
    if (this.actorController && (this.actorController as any).getType?.() === charType) {
      return
    }
    if (this.actorController) {
      this.scene.remove(this.actorController.group)
      this.actorController.dispose()
    }
    this.actorController = ActorFactory.create(charType as 'human' | 'car')
    this.actorController.setPosition(this.actorPosition.x, this.actorPosition.y, this.actorPosition.z, 0)
    this.scene.add(this.actorController.group)
  }

  private keyframes: Array<{ id: string; t: number; mode: string }> = []
  public isPlaying = true

  public setKeyframes(keyframes: Array<{ id: string; t: number; mode: string }>): void {
    this.keyframes = [...keyframes].sort((a, b) => a.t - b.t)
  }

  public getActiveKeyframeMode(time: number): string {
    if (!this.keyframes || this.keyframes.length === 0) {
      return this.state.camera_mode || 'Third Person'
    }
    const sorted = [...this.keyframes].sort((a, b) => a.t - b.t)
    let activeMode = sorted[0].mode
    for (let i = 0; i < sorted.length; i++) {
      if (time >= sorted[i].t) {
        activeMode = sorted[i].mode
      } else {
        break
      }
    }
    return activeMode
  }

  public isRecordingMode = false

  public setIsRecordingMode(active: boolean): void {
    this.isRecordingMode = active
  }

  private updateActorMovement(dt: number): void {
    if (!this.actorController) return
    this.playbackController.update(dt, this.actorController)
    this.actorPosition.copy(this.actorController.position)
  }

  private lastCameraMode: string | null = null

  private updateCamera(): void {
    if (!this.actorController) return

    const charPos = this.actorPosition
    const rotY = this.actorController.group.rotation.y
    const activeMode = this.getActiveKeyframeMode(this.playbackController.getCurrentTime())

    const isFPV = activeMode === 'First Person'
    this.actorController.setMeshVisibleForFPV(isFPV)

    if (isFPV) {
      if (this.camera.fov !== 50) {
        this.camera.fov = 50
        this.camera.updateProjectionMatrix()
      }
      const localOffset = this.actorController.getFPVOffset()
      const worldOffset = localOffset.clone().applyQuaternion(this.actorController.group.quaternion)
      const fpvCamPos = charPos.clone().add(worldOffset)
      this.camera.position.copy(fpvCamPos)

      const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(this.actorController.group.quaternion)
      this.camera.lookAt(fpvCamPos.clone().add(forward))

    } else if (activeMode === 'Third Person') {
      if (this.camera.fov !== 50) {
        this.camera.fov = 50
        this.camera.updateProjectionMatrix()
      }
      const backOffset = new THREE.Vector3(0, 1.8, -3.5).applyAxisAngle(new THREE.Vector3(0, 1, 0), rotY)
      const targetCamPos = charPos.clone().add(backOffset)
      // Instant hard cut & lock on TPV position without sliding lerp drift
      this.camera.position.copy(targetCamPos)
      this.camera.lookAt(charPos.x, charPos.y + 0.8, charPos.z)

    } else if (activeMode === 'Wide') {
      // Low FOV for telephoto perspective
      if (this.camera.fov !== 28) {
        this.camera.fov = 28
        this.camera.updateProjectionMatrix()
      }
      // Fixed position high up in a corner of the stage
      this.camera.position.set(-11, 7, 11)
      const targetPos = new THREE.Vector3(charPos.x * 0.35, charPos.y + 0.4, charPos.z * 0.35)
      if (this.lastCameraMode !== 'Wide') {
        this.wideTarget.copy(targetPos)
      } else {
        this.wideTarget.lerp(targetPos, 0.05)
      }
      this.camera.lookAt(this.wideTarget)

    } else if (activeMode === 'Side') {
      // Side tracking profile camera with custom 40° FOV
      if (this.camera.fov !== 40) {
        this.camera.fov = 40
        this.camera.updateProjectionMatrix()
      }
      // Positioned to the side of the actor tracking alongside
      const sideOffset = new THREE.Vector3(-3.2, 1.4, 0.5).applyAxisAngle(new THREE.Vector3(0, 1, 0), rotY)
      const targetCamPos = charPos.clone().add(sideOffset)
      this.camera.position.copy(targetCamPos)
      this.camera.lookAt(charPos.x, charPos.y + 0.8, charPos.z)
    }

    this.lastCameraMode = activeMode
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
    this.updateCamera()

    this.renderer.render(this.scene, this.camera)
  }

  public setState(newState: Partial<DirectingState>): void {
    if (newState.camera_mode !== undefined) {
      this.state.camera_mode = newState.camera_mode
    }
    if (newState.acting_data !== undefined) {
      this.state.acting_data = newState.acting_data
      this.loadActingData(newState.acting_data)
    }
    if (newState.directing_data !== undefined) {
      this.state.directing_data = newState.directing_data
    }
  }

  private mediaRecorder: MediaRecorder | null = null
  private recordedChunks: Blob[] = []

  public startRecording(fps: number = 30): void {
    this.lastCameraMode = null

    // Enforce fixed 720p (1280x720) WebGL rendering resolution independent of container canvas size
    const targetWidth = 1280
    const targetHeight = 720
    this.renderer.setSize(targetWidth, targetHeight, false)
    this.camera.aspect = targetWidth / targetHeight
    this.camera.updateProjectionMatrix()

    this.updateActorMovement(0)
    this.updateCamera()

    const canvas = this.renderer.domElement
    const stream = (canvas as any).captureStream ? (canvas as any).captureStream(fps) : (canvas as any).mozCaptureStream(fps)
    this.recordedChunks = []

    let options: MediaRecorderOptions = { mimeType: 'video/webm;codecs=vp9' }
    if (!MediaRecorder.isTypeSupported(options.mimeType!)) {
      options = { mimeType: 'video/webm;codecs=vp8' }
    }
    if (!MediaRecorder.isTypeSupported(options.mimeType!)) {
      options = { mimeType: 'video/webm' }
    }

    this.mediaRecorder = new MediaRecorder(stream, options)
    this.mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) {
        this.recordedChunks.push(e.data)
      }
    }
    this.mediaRecorder.start()
  }

  public stopRecording(): Promise<Blob> {
    return new Promise((resolve, reject) => {
      if (!this.mediaRecorder) {
        reject(new Error('No recording in progress'))
        return
      }

      this.mediaRecorder.onstop = () => {
        const blob = new Blob(this.recordedChunks, { type: 'video/webm' })
        // Restore container aspect & buffer size
        this.onResize()
        resolve(blob)
      }

      this.mediaRecorder.stop()
    })
  }

  public captureStageSnapshot(): Promise<Blob> {
    return new Promise((resolve, reject) => {
      if (!this.renderer || !this.scene) {
        reject(new Error('ThreeDirecting not initialized'))
        return
      }

      // Save current playback time and snap actor to initial frame (t = 0.0s)
      const prevTime = this.playbackController.getCurrentTime()
      this.playbackController.setCurrentTime(0)
      this.updateActorMovement(0)

      // Temporarily disable fog for crisp overview render without fog haze
      const prevFog = this.scene.fog
      this.scene.fog = null

      // Enforce fixed 720p (1280x720) resolution for stage overview snapshot
      const targetWidth = 1280
      const targetHeight = 720
      this.renderer.setSize(targetWidth, targetHeight, false)

      // Dedicated stage camera with lower FOV (15°) for telephoto stage overview
      const stageCamera = new THREE.PerspectiveCamera(15, targetWidth / targetHeight, 0.1, 200)
      stageCamera.position.set(-26, 22, 26)
      stageCamera.lookAt(0, 0, 0)
      stageCamera.updateProjectionMatrix()

      // Render stage overview frame at initial frame (t = 0.0s)
      this.renderer.render(this.scene, stageCamera)

      const canvas = this.renderer.domElement
      canvas.toBlob((blob) => {
        // Restore scene fog, playback time, actor position, standard camera view, and container resolution
        this.scene.fog = prevFog
        this.playbackController.setCurrentTime(prevTime)
        this.updateActorMovement(0)
        this.onResize()
        this.renderer.render(this.scene, this.camera)
        if (blob) {
          resolve(blob)
        } else {
          reject(new Error('Failed to generate stage blob'))
        }
      }, 'image/png')
    })
  }

  public play(): void {
    this.playbackController.play()
  }

  public pause(): void {
    this.playbackController.pause()
  }

  public stop(): void {
    this.playbackController.stop()
    if (this.actorController) {
      this.playbackController.evaluateAt(0, this.actorController)
      this.actorPosition.copy(this.actorController.position)
    }
  }

  public getIsPlaying(): boolean {
    return this.playbackController.getIsPlaying()
  }

  public resetPlayback(): void {
    this.stop()
    this.lastCameraMode = null
    this.updateActorMovement(0)
    this.updateCamera()
  }

  public seekToTime(t: number): void {
    const maxDur = this.getDuration()
    this.playbackController.setCurrentTime(Math.max(0, Math.min(t, maxDur)))
    this.lastCameraMode = null
    this.updateActorMovement(0)
    this.updateCamera()
  }

  public getCurrentTime(): number {
    return this.playbackController.getCurrentTime()
  }

  public getDuration(): number {
    const maxDuration = this.playbackController.getMaxDuration()
    return maxDuration > 0 ? maxDuration : 7.0
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

    this.renderer.dispose()
    this.scene.clear()
  }

  public getState(): DirectingState {
    return this.state
  }

  public getScene(): THREE.Scene {
    return this.scene
  }
}
