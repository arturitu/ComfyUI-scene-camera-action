import * as THREE from 'three'
import type { DirectingState, ThreeDirectingOptions } from './types'
import * as config from './threeConfig'
import { BaseActor } from './actors/BaseActor'
import { ActorFactory } from './actors/ActorFactory'
import { PlaybackController } from './utils/PlaybackController'
import { StageEnvironment } from './staging/StageEnvironment'

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
  private tpvTarget = new THREE.Vector3(0, 0, 0)
  private sideTarget = new THREE.Vector3(0, 0, 0)
  private cachedSceneExtent = 15.0
  private cachedEnvBBox = new THREE.Box3()
  private cachedBBoxCenter = new THREE.Vector3()
  private cachedBBoxSize = new THREE.Vector3()
  private lastSceneDataJson: string | null = null
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
    let parsedActorType: string | undefined
    if (actingDataJson && actingDataJson.trim()) {
      try {
        const parsed = JSON.parse(actingDataJson)
        if (typeof parsed === 'object' && parsed !== null) {
          parsedActorType = parsed.actor_type || parsed.actorType || parsed.char_type
          const stageData = parsed.stage_data || parsed.scene_data
          if (stageData && !this.connectedThreeActing) {
            this.buildStageFromData(stageData)
          }
        }
      } catch (e) {
        console.warn('[ThreeDirecting] JSON parse error in loadActingData:', e)
      }
      this.playbackController.setTrajectory(actingDataJson)
      this.playbackController.start()
    } else {
      this.playbackController.setTrajectory('')
      this.playbackController.stop()
    }

    const currentStageData = this.getStageData()
    const currentStageJson = currentStageData ? JSON.stringify(currentStageData) : ''
    if (currentStageJson !== this.lastSceneDataJson || !this.clonedEnvGroup) {
      this.lastSceneDataJson = currentStageJson
      this.buildStageEnvironment()
    }
    this.buildActor(parsedActorType)

    if (this.actorController) {
      if (this.playbackController.getTrajectory().length > 0) {
        this.playbackController.evaluateAt(0, this.actorController)
      }
      this.actorPosition.copy(this.actorController.position)
    }
    this.updateCamera()
  }



  private initThreeJS(): void {
    const width = this.container.clientWidth || 400
    const height = this.container.clientHeight || 350

    this.scene = new THREE.Scene()
    const bgColor = new THREE.Color(config.BACKGROUND_COLOR)
    this.scene.background = bgColor
    this.scene.fog = new THREE.Fog(bgColor, config.FOG_NEAR, config.FOG_FAR)

    this.camera = new THREE.PerspectiveCamera(50, width / height, config.CAMERA_NEAR, config.CAMERA_FAR)
    this.camera.position.set(-8, 4, 0)
    this.camera.lookAt(0, 0, 0)

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    this.renderer.setSize(width, height, false)
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    const canvas = this.renderer.domElement
    this.container.appendChild(canvas)
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

  public getStageData(): any {
    let actingPayload: any = this.state.acting_data
    if (typeof actingPayload === 'string') {
      try { actingPayload = JSON.parse(actingPayload) } catch (e) { }
    }
    if (actingPayload?.stage_data || actingPayload?.scene_data) {
      return actingPayload.stage_data || actingPayload.scene_data
    }
    if (this.connectedThreeActing) {
      if (typeof this.connectedThreeActing.getStageData === 'function') {
        return this.connectedThreeActing.getStageData()
      }
      if (typeof this.connectedThreeActing.getSceneData === 'function') {
        return this.connectedThreeActing.getSceneData()
      }
      if (typeof this.connectedThreeActing.getState === 'function') {
        const actingState = this.connectedThreeActing.getState()
        if (actingState?.stage_data || actingState?.scene_data) {
          return actingState.stage_data || actingState.scene_data
        }
      }
    }
    return undefined
  }
  public getSceneData(): any {
    return this.getStageData()
  }

  public buildStageEnvironment(): void {
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

    const stageData = this.getStageData()

    const stageEnv = new StageEnvironment()
    stageEnv.buildObjectsFromData(stageData, this.clonedEnvGroup)

    if (this.clonedEnvGroup && this.clonedEnvGroup.children.length > 0) {
      this.cachedEnvBBox.setFromObject(this.clonedEnvGroup)
    } else {
      this.cachedEnvBBox.makeEmpty()
    }

    // Dynamically adjust fog based on environment stage extent
    this.cachedSceneExtent = config.calculateStageExtent(this.clonedEnvGroup)
    config.updateStageFog(this.scene, this.camera, this.cachedSceneExtent)

    this.buildActor()
  }
  public buildSceneEnvironment(): void {
    this.buildStageEnvironment()
  }

  public buildStageFromData(stageData: any): void {
    let actingPayload: any = this.state.acting_data
    if (typeof actingPayload === 'string') {
      try { actingPayload = JSON.parse(actingPayload) } catch (e) { }
    }
    if (!actingPayload || typeof actingPayload !== 'object') {
      actingPayload = {}
    }
    actingPayload.stage_data = stageData
    actingPayload.scene_data = stageData
    this.state.acting_data = actingPayload
    this.buildStageEnvironment()
  }
  public buildSceneFromData(sceneData: any): void {
    this.buildStageFromData(sceneData)
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

  public getActiveKeyframe(time: number): { id: string; mode: string } {
    if (!this.keyframes || this.keyframes.length === 0) {
      return { id: 'default', mode: this.state.camera_mode || 'Third Person' }
    }
    const sorted = [...this.keyframes].sort((a, b) => a.t - b.t)
    let active = sorted[0]
    for (let i = 0; i < sorted.length; i++) {
      if (time >= sorted[i].t) {
        active = sorted[i]
      } else {
        break
      }
    }
    return { id: active.id, mode: active.mode }
  }

  public getActiveKeyframeMode(time: number): string {
    return this.getActiveKeyframe(time).mode
  }

  public isRecordingMode = false

  public setIsRecordingMode(active: boolean): void {
    this.isRecordingMode = active
    this.playbackController.setIsRecordingMode(active)
    this.playbackController.setLoop(!active)
  }

  private updateActorMovement(dt: number): void {
    if (!this.actorController) return
    this.playbackController.update(dt, this.actorController)
    this.actorPosition.copy(this.actorController.position)
  }

  private lastCameraMode: string | null = null
  private lastActiveKeyframeId: string | null = null
  private forceHardCutNextCameraUpdate: boolean = false
  private smoothedCameraYaw: number = 0

  private updateCamera(dt: number = 0.016): void {
    if (!this.actorController) return

    const charPos = this.actorPosition
    const rotY = this.actorController.group.rotation.y
    const currentTime = this.playbackController.getCurrentTime()
    const activeKeyframe = this.getActiveKeyframe(currentTime)
    const activeMode = activeKeyframe.mode

    const isPlaying = this.playbackController.getIsPlaying()
    let isHardCut = this.playbackController.consumeHardCut() || this.forceHardCutNextCameraUpdate

    // Abrupt hard cut on keyframe cut or mode change
    if (this.lastActiveKeyframeId !== null && this.lastActiveKeyframeId !== activeKeyframe.id) {
      isHardCut = true
    }
    if (this.lastCameraMode !== null && this.lastCameraMode !== activeMode) {
      isHardCut = true
    }

    this.forceHardCutNextCameraUpdate = false
    this.lastActiveKeyframeId = activeKeyframe.id

    // If paused and no seek/hard-cut was triggered, freeze camera in exact current visual state without jumping
    if (!isPlaying && !isHardCut && this.lastCameraMode === activeMode) {
      const activeTarget = activeMode === 'Wide' ? this.wideTarget : (activeMode === 'Side' ? this.sideTarget : this.tpvTarget)
      config.updateSceneFog(this.scene, this.camera, this.cachedSceneExtent, activeTarget)
      return
    }

    if (this.lastCameraMode !== activeMode || isHardCut) {
      this.smoothedCameraYaw = rotY
    } else {
      let diffYaw = rotY - this.smoothedCameraYaw
      while (diffYaw < -Math.PI) diffYaw += Math.PI * 2
      while (diffYaw > Math.PI) diffYaw -= Math.PI * 2
      const yawLerpFactor = 1.0 - Math.exp(-4.5 * Math.max(0.001, dt))
      this.smoothedCameraYaw += diffYaw * yawLerpFactor
    }

    const posLerpFactor = 1.0 - Math.exp(-6.0 * Math.max(0.001, dt))

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
      const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(this.actorController.group.quaternion)
      const targetLookAt = fpvCamPos.clone().add(forward)

      if (this.lastCameraMode !== 'First Person' || isHardCut) {
        this.camera.position.copy(fpvCamPos)
        this.camera.lookAt(targetLookAt)
      } else {
        const fpvLerpFactor = 1.0 - Math.exp(-10.0 * Math.max(0.001, dt))
        this.camera.position.lerp(fpvCamPos, fpvLerpFactor)
        this.camera.lookAt(targetLookAt)
      }

    } else if (activeMode === 'Third Person') {
      if (this.camera.fov !== 50) {
        this.camera.fov = 50
        this.camera.updateProjectionMatrix()
      }
      const isCrouch = this.actorController?.isCrouching() ?? false
      const camHeight = isCrouch ? 1.0 : 1.8
      const camDist = isCrouch ? -2.8 : -3.5
      const targetYOffset = isCrouch ? 1.05 : 0.8

      const backOffset = new THREE.Vector3(0, camHeight, camDist).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.smoothedCameraYaw)
      const targetCamPos = charPos.clone().add(backOffset)
      const targetLookAt = new THREE.Vector3(charPos.x, charPos.y + targetYOffset, charPos.z)

      if (this.lastCameraMode !== 'Third Person' || isHardCut) {
        // Hard cut on initial mode change or timeline loop/seek
        this.camera.position.copy(targetCamPos)
        this.tpvTarget.copy(targetLookAt)
      } else {
        // Smooth camera follow lerp
        this.camera.position.lerp(targetCamPos, posLerpFactor)
        this.tpvTarget.lerp(targetLookAt, posLerpFactor)
      }
      this.camera.lookAt(this.tpvTarget)

    } else if (activeMode === 'Wide') {
      const fov = 35
      if (this.camera.fov !== fov) {
        this.camera.fov = fov
        this.camera.updateProjectionMatrix()
      }

      // Reuse cached bounding box of active stage environment
      let center = charPos.clone()
      let size = new THREE.Vector3(12, 6, 12)

      if (!this.cachedEnvBBox.isEmpty()) {
        this.cachedEnvBBox.getCenter(this.cachedBBoxCenter)
        this.cachedEnvBBox.getSize(this.cachedBBoxSize)

        // Blend stage center with actor position (70% scene center, 30% actor position)
        center.copy(this.cachedBBoxCenter).lerp(charPos, 0.3)
        size.copy(this.cachedBBoxSize)
      }

      const maxSpan = Math.max(size.x, size.z, 10.0)
      const dist = Math.max(12.0, (maxSpan / 2.0) / Math.tan((fov * Math.PI / 180) / 2.0) * 0.75)

      // Cinematic elevated corner angle offset relative to scene bounds
      const idealCamPos = center.clone().add(new THREE.Vector3(-dist * 0.7, dist * 0.5, dist * 0.7))

      if (this.lastCameraMode !== 'Wide' || isHardCut) {
        this.wideTarget.copy(center)
        this.camera.position.copy(idealCamPos)
      } else {
        const wideLerpFactor = 1.0 - Math.exp(-3.0 * Math.max(0.001, dt))
        this.wideTarget.lerp(center, wideLerpFactor)
        this.camera.position.lerp(idealCamPos, wideLerpFactor)
      }
      this.camera.lookAt(this.wideTarget.x, this.wideTarget.y + 0.5, this.wideTarget.z)

    } else if (activeMode === 'Side') {
      const isCar = (this.actorController as any)?.getType?.() === 'car'
      const fov = 45
      if (this.camera.fov !== fov) {
        this.camera.fov = fov
        this.camera.updateProjectionMatrix()
      }

      const sideVec = isCar ? new THREE.Vector3(-4.8, 1.3, 0.4) : new THREE.Vector3(-4.5, 1.4, 0.4)
      const targetOffsetY = isCar ? 0.55 : 1.15
      const sideOffset = sideVec.applyAxisAngle(new THREE.Vector3(0, 1, 0), this.smoothedCameraYaw)
      const targetCamPos = charPos.clone().add(sideOffset)
      const targetLookAt = new THREE.Vector3(charPos.x, charPos.y + targetOffsetY, charPos.z)

      if (this.lastCameraMode !== 'Side' || isHardCut) {
        // Hard cut on initial mode change
        this.camera.position.copy(targetCamPos)
        this.sideTarget.copy(targetLookAt)
      } else {
        // Smooth camera follow lerp
        this.camera.position.lerp(targetCamPos, posLerpFactor)
        this.sideTarget.lerp(targetLookAt, posLerpFactor)
      }
      this.camera.lookAt(this.sideTarget)
    }

    const activeTarget = activeMode === 'Wide' ? this.wideTarget : (activeMode === 'Side' ? this.sideTarget : this.tpvTarget)
    config.updateSceneFog(this.scene, this.camera, this.cachedSceneExtent, activeTarget)

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
    this.playbackController.setCurrentTime(0)
    this.playbackController.play()
    this.isPlaying = true

    // Enforce fixed 720p (1280x720) WebGL rendering resolution independent of container canvas size
    const targetWidth = 1280
    const targetHeight = 720
    this.renderer.setSize(targetWidth, targetHeight, false)
    this.camera.aspect = targetWidth / targetHeight
    this.camera.updateProjectionMatrix()

    this.updateActorMovement(0)
    this.updateCamera()

    // Force explicit WebGL render of initial frame to ensure fresh buffer
    this.renderer.render(this.scene, this.camera)

    const canvas = this.renderer.domElement
    const stream = (canvas as any).captureStream ? (canvas as any).captureStream(fps) : (canvas as any).mozCaptureStream(fps)
    this.recordedChunks = []

    let options: MediaRecorderOptions = {
      mimeType: 'video/webm;codecs=vp9',
      videoBitsPerSecond: 16000000 // 16 Mbps for high bitrate & sharp initial frames
    }
    if (!MediaRecorder.isTypeSupported(options.mimeType!)) {
      options = {
        mimeType: 'video/webm;codecs=vp8',
        videoBitsPerSecond: 16000000
      }
    }
    if (!MediaRecorder.isTypeSupported(options.mimeType!)) {
      options = {
        mimeType: 'video/webm',
        videoBitsPerSecond: 16000000
      }
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

  public captureCurrentCanvasSnapshot(): Promise<Blob> {
    return new Promise((resolve, reject) => {
      if (!this.renderer || !this.scene) {
        reject(new Error('ThreeDirecting not initialized'))
        return
      }

      this.renderer.render(this.scene, this.camera)
      const canvas = this.renderer.domElement
      canvas.toBlob((blob) => {
        if (blob) {
          resolve(blob)
        } else {
          reject(new Error('Failed to capture current canvas snapshot'))
        }
      }, 'image/png')
    })
  }

  public captureStageSnapshot(): Promise<Blob> {
    return new Promise((resolve, reject) => {
      if (!this.renderer || !this.scene) {
        reject(new Error('ThreeDirecting not initialized'))
        return
      }

      // Save current playback time and snap actor & camera to initial frame (t = 0.0s)
      const prevTime = this.playbackController.getCurrentTime()
      this.playbackController.setCurrentTime(0)
      this.updateActorMovement(0)
      this.updateCamera()

      // Enforce fixed 720p (1280x720) resolution for stage snapshot
      const targetWidth = 1280
      const targetHeight = 720
      this.renderer.setSize(targetWidth, targetHeight, false)
      this.camera.aspect = targetWidth / targetHeight
      this.camera.updateProjectionMatrix()

      // Render initial frame (t = 0.0s) using directed camera
      this.renderer.render(this.scene, this.camera)

      const canvas = this.renderer.domElement
      canvas.toBlob((blob) => {
        // Restore playback time, actor position, standard camera view, and container resolution
        this.playbackController.setCurrentTime(prevTime)
        this.updateActorMovement(0)
        this.updateCamera()
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
      const firstFrame = this.playbackController.getTrajectory()[0]
      const initialAnim = firstFrame?.anim
      this.actorController.resetAnimation(initialAnim)
      this.playbackController.evaluateAt(0, this.actorController, 0)
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
    const targetT = Math.max(0, Math.min(t, maxDur))
    this.playbackController.setCurrentTime(targetT)
    if (targetT === 0 && this.actorController) {
      const firstFrame = this.playbackController.getTrajectory()[0]
      const initialAnim = firstFrame?.anim
      this.actorController.resetAnimation(initialAnim)
    }
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

    if (this.renderer) {
      this.renderer.dispose()
      this.renderer.forceContextLoss()
      if (this.renderer.domElement && this.renderer.domElement.parentElement) {
        this.renderer.domElement.remove()
      }
    }
    this.scene.clear()
  }

  public getState(): DirectingState {
    return this.state
  }

  public getScene(): THREE.Scene {
    return this.scene
  }
}
