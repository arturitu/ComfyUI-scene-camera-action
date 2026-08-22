import * as THREE from 'three'
import type { DirectingState, ThreeDirectingOptions } from './types'
import * as config from './threeConfig'
import { BaseActor } from './actors/BaseActor'
import { ActorFactory } from './actors/ActorFactory'
import { PlaybackController } from './utils/PlaybackController'
import { StageEnvironment } from './staging/StageEnvironment'
import { CameraSpringArm } from './utils/CameraSpringArm'
import { InstancedStageMesh } from './staging/InstancedStageMesh'

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
  private instancedStageMesh: InstancedStageMesh | null = null
  private connectedThreeActing: any = null
  private springArm = new CameraSpringArm()

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
    const stageData = this.getStageData()
    if (stageData) {
      this.buildStageFromData(stageData)
    }
    if (this.state.acting_data) {
      this.loadActingData(this.state.acting_data)
    } else if (threeActing && typeof threeActing.getAccumulatedActors === 'function') {
      this.buildActorsFromData({ actors: threeActing.getAccumulatedActors() })
    }
    this.buildStageEnvironment()
    this.updateCamera()
  }

  private actorList: Array<{
    id: string
    controller: BaseActor
    playbackController: PlaybackController
    record: any
  }> = []

  public getAvailableActors(): Array<{ id: string; label: string }> {
    const list: Array<{ id: string; label: string }> = []
    if (this.actorList.length === 0) {
      list.push({ id: 'actor_1', label: 'Actor 1 (human)' })
      return list
    }
    this.actorList.forEach((a, idx) => {
      list.push({
        id: a.id,
        label: `Actor ${idx + 1} (${a.record.actor_type || 'human'})`
      })
    })
    return list
  }

  public loadActingData(actingDataInput: any): void {
    let parsedPayload: any = null
    let rawString = ''

    if (typeof actingDataInput === 'string') {
      rawString = actingDataInput
      if (actingDataInput.trim()) {
        try {
          parsedPayload = JSON.parse(actingDataInput)
        } catch (e) {
          console.warn('[ThreeDirecting] JSON parse error in loadActingData:', e)
        }
      }
    } else if (typeof actingDataInput === 'object' && actingDataInput !== null) {
      parsedPayload = actingDataInput
      try {
        rawString = JSON.stringify(actingDataInput)
      } catch (e) { }
    }

    if (parsedPayload) {
      const stageData = parsedPayload.stage_data || parsedPayload.scene_data
      if (stageData && !this.connectedThreeActing) {
        this.buildStageFromData(stageData)
      }
      this.playbackController.setTrajectory(rawString)
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

    this.buildActorsFromData(parsedPayload)
    const maxDur = this.getDuration()
    if (maxDur > 0) {
      (this.playbackController as any).maxDuration = maxDur
    }

    if (this.actorController) {
      this.actorPosition.copy(this.actorController.position)
    }
    this.updateCamera()
  }

  private buildActorsFromData(parsedPayload: any): void {
    this.actorList.forEach(a => {
      this.scene.remove(a.controller.group)
      a.controller.dispose()
    })
    this.actorList = []

    let actorsArr: any[] = []
    if (parsedPayload && Array.isArray(parsedPayload.actors) && parsedPayload.actors.length > 0) {
      actorsArr = parsedPayload.actors
    } else if (this.connectedThreeActing && typeof (this.connectedThreeActing as any).getAccumulatedActors === 'function') {
      const acc = (this.connectedThreeActing as any).getAccumulatedActors()
      if (Array.isArray(acc) && acc.length > 0) {
        actorsArr = acc
      }
    } else if (parsedPayload && (parsedPayload.trajectory || parsedPayload.motion_data)) {
      let traj = parsedPayload.trajectory
      if (!traj && parsedPayload.motion_data) {
        traj = typeof parsedPayload.motion_data === 'string' ? JSON.parse(parsedPayload.motion_data).trajectory : parsedPayload.motion_data
      }
      actorsArr = [{
        id: 'actor_1',
        actor_type: parsedPayload.actor_type || 'human',
        trajectory: traj || []
      }]
    }

    actorsArr.forEach((rec, idx) => {
      const actorId = rec.id || `actor_${idx + 1}`
      const actorCtrl = ActorFactory.create(rec.actor_type || 'human')
      const color = rec.actor_color || (rec.actor_type === 'human' ? '#F1DFBF' : '#0284C7')
      actorCtrl.setActorColor(color)
      const pbCtrl = new PlaybackController()
      let traj = rec.trajectory || rec.motion_data
      if (typeof traj === 'string' && traj.trim()) {
        try {
          const parsed = JSON.parse(traj)
          traj = parsed.trajectory || parsed.motion_data || parsed
        } catch (e) {}
      }
      pbCtrl.setTrajectory(traj || [])
      const firstFrame = pbCtrl.getTrajectory()[0]
      const initialAnim = firstFrame?.anim
      if (initialAnim) {
        actorCtrl.resetAnimation(initialAnim)
      }
      pbCtrl.evaluateAt(0, actorCtrl, 0, true)

      this.scene.add(actorCtrl.group)
      this.actorList.push({
        id: actorId,
        controller: actorCtrl,
        playbackController: pbCtrl,
        record: rec
      })
    })

    if (this.actorList.length > 0) {
      this.actorController = this.actorList[0].controller
    } else {
      this.actorController = null
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

    if (this.instancedStageMesh) {
      this.instancedStageMesh.dispose()
      this.instancedStageMesh = null
    }

    this.clonedEnvGroup = new THREE.Group()
    this.scene.add(this.clonedEnvGroup)

    const stageData = this.getStageData()

    const stageEnv = new StageEnvironment()
    this.instancedStageMesh = stageEnv.buildInstancedStage(stageData, this.clonedEnvGroup)

    if (this.clonedEnvGroup && this.clonedEnvGroup.children.length > 0) {
      this.cachedEnvBBox.setFromObject(this.clonedEnvGroup)
    } else {
      this.cachedEnvBBox.makeEmpty()
    }

    // Dynamically adjust fog based on environment stage extent
    this.cachedSceneExtent = config.calculateStageExtent(this.clonedEnvGroup)
    config.updateStageFog(this.scene, this.camera, this.cachedSceneExtent)
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
    const color = (charType === 'human' ? '#F1DFBF' : '#0284C7')
    this.actorController.setActorColor(color)
    this.actorController.setPosition(this.actorPosition.x, this.actorPosition.y, this.actorPosition.z, 0)
    this.scene.add(this.actorController.group)
  }

  private keyframes: Array<{ id: string; t: number; mode: string; actor_target?: string; fov?: number }> = []
  public isPlaying = true

  public setKeyframes(keyframes: Array<{ id: string; t: number; mode: string; actor_target?: string; fov?: number }>): void {
    this.keyframes = [...keyframes].sort((a, b) => a.t - b.t)
    this.forceHardCutNextCameraUpdate = true
    this.updateCamera(0)
  }

  public getActiveKeyframe(time: number): { id: string; t: number; mode: string; actor_target?: string; fov?: number } {
    if (this.keyframes.length === 0) {
      return { id: 'default', t: 0, mode: this.state.camera_mode || 'Third Person' }
    }
    let active = this.keyframes[0]
    for (let i = 0; i < this.keyframes.length; i++) {
      if (this.keyframes[i].t <= time) {
        active = this.keyframes[i]
      } else {
        break
      }
    }
    return active
  }

  public getActiveKeyframeMode(time: number): string {
    return this.getActiveKeyframe(time).mode
  }

  public isRecordingVideo = false

  public setIsRecordingMode(active: boolean): void {
    this.isRecordingVideo = active
    this.playbackController.setIsRecordingMode(active)
    this.playbackController.setLoop(!active)
  }

  private updateActorMovement(dt: number): void {
    const isPlaying = this.playbackController.getIsPlaying()
    if (isPlaying) {
      // Avoid evaluating actorController twice if actorList is managing scene actors
      const targetActor = this.actorList.length > 0 ? null : this.actorController
      this.playbackController.update(dt, targetActor)
    }
    const curTime = this.playbackController.getCurrentTime()
    const evalDt = isPlaying ? dt : 0

    if (this.actorList.length > 0) {
      this.actorList.forEach(a => {
        a.playbackController.evaluateAt(curTime, a.controller, evalDt)
      })
      const primaryActor = this.actorList[this.actorList.length - 1].controller
      if (primaryActor) {
        this.actorPosition.copy(primaryActor.position)
      }
    } else if (this.actorController) {
      this.playbackController.evaluateAt(curTime, this.actorController, evalDt)
      this.actorPosition.copy(this.actorController.position)
    }
  }

  private lastCameraMode: string | null = null
  private lastActiveKeyframeId: string | null = null
  private lastTargetActorId: string | null = null
  private forceHardCutNextCameraUpdate: boolean = false
  private smoothedCameraYaw: number = 0

  private updateCamera(dt: number = 0.016): void {
    const currentTime = this.playbackController.getCurrentTime()
    const activeKeyframe = this.getActiveKeyframe(currentTime)
    const activeMode = activeKeyframe.mode

    // Select target actor controller for camera tracking
    let targetActorCtrl: BaseActor | null = null
    let targetActorId = 'actor_1'

    if (activeKeyframe.actor_target && this.actorList.length > 0) {
      const found = this.actorList.find(a => a.id === activeKeyframe.actor_target)
      if (found) {
        targetActorCtrl = found.controller
        targetActorId = found.id
      }
    }
    if (!targetActorCtrl && this.actorList.length > 0) {
      targetActorCtrl = this.actorList[0].controller
      targetActorId = this.actorList[0].id
    }
    if (!targetActorCtrl) {
      targetActorCtrl = this.actorController
      if (targetActorCtrl) targetActorId = 'actor_1'
    }

    const charPos = targetActorCtrl ? targetActorCtrl.position : new THREE.Vector3(0, config.GROUND_Y, 0)
    const rotY = targetActorCtrl ? targetActorCtrl.group.rotation.y : 0

    const isFPV = activeMode === 'First Person' && targetActorCtrl !== null

    // Update mesh visibility for all actors before any early return:
    // Only hide an actor if it is the current target actor and active mode is First Person (FPV)
    if (this.actorList.length > 0) {
      this.actorList.forEach(a => {
        const isThisActorFPV = isFPV && (a.controller === targetActorCtrl || a.id === targetActorId)
        a.controller.setMeshVisibleForFPV(isThisActorFPV)
      })
    }
    if (this.actorController) {
      const isPrimaryFPV = isFPV && (this.actorController === targetActorCtrl)
      this.actorController.setMeshVisibleForFPV(isPrimaryFPV)
    }

    const isPlaying = this.playbackController.getIsPlaying()
    let isHardCut = this.playbackController.consumeHardCut() || this.forceHardCutNextCameraUpdate

    // Abrupt hard cut on keyframe cut, mode change, or target actor change
    if (this.lastActiveKeyframeId !== null && this.lastActiveKeyframeId !== activeKeyframe.id) {
      isHardCut = true
    }
    if (this.lastCameraMode !== null && this.lastCameraMode !== activeMode) {
      isHardCut = true
    }
    if (this.lastTargetActorId !== null && this.lastTargetActorId !== targetActorId) {
      isHardCut = true
    }

    // Freeze camera at exact current rendered position when paused (unless seek or keyframe change occurred)
    if (!isPlaying && !isHardCut) {
      this.forceHardCutNextCameraUpdate = false
      this.lastActiveKeyframeId = activeKeyframe.id
      this.lastTargetActorId = targetActorId
      return
    }

    this.forceHardCutNextCameraUpdate = false
    this.lastActiveKeyframeId = activeKeyframe.id
    this.lastTargetActorId = targetActorId

    const isCarTarget = (targetActorCtrl as any)?.getType?.() === 'car'

    if (this.lastCameraMode !== activeMode || isHardCut) {
      this.smoothedCameraYaw = rotY
      this.springArm.reset()
    } else {
      let diffYaw = rotY - this.smoothedCameraYaw
      while (diffYaw < -Math.PI) diffYaw += Math.PI * 2
      while (diffYaw > Math.PI) diffYaw -= Math.PI * 2
      const yawSpeed = isCarTarget ? 10.0 : 4.5
      const yawLerpFactor = 1.0 - Math.exp(-yawSpeed * Math.max(0.001, dt))
      this.smoothedCameraYaw += diffYaw * yawLerpFactor
    }

    const posLerpSpeed = isCarTarget ? 12.0 : 6.0
    const posLerpFactor = 1.0 - Math.exp(-posLerpSpeed * Math.max(0.001, dt))

    // Determine target FOV for active keyframe and mode
    let targetFov = activeKeyframe.fov
    if (targetFov === undefined) {
      targetFov = config.getDefaultCameraFov(activeMode)
    }

    if (this.camera.fov !== targetFov) {
      this.camera.fov = targetFov
      this.camera.updateProjectionMatrix()
    }

    if (isFPV && targetActorCtrl) {
      const localOffset = targetActorCtrl.getFPVOffset()
      const worldOffset = localOffset.clone().applyQuaternion(targetActorCtrl.group.quaternion)
      const fpvCamPos = charPos.clone().add(worldOffset)
      const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(targetActorCtrl.group.quaternion)
      const targetLookAt = fpvCamPos.clone().add(forward)

      if (this.lastCameraMode !== 'First Person' || isHardCut) {
        this.camera.position.copy(fpvCamPos)
        this.camera.lookAt(targetLookAt)
      } else {
        const fpvLerpFactor = 1.0 - Math.exp(-10.0 * Math.max(0.001, dt))
        this.camera.position.lerp(fpvCamPos, fpvLerpFactor)
        this.camera.lookAt(targetLookAt)
      }

      if (this.instancedStageMesh) {
        this.instancedStageMesh.setDitherOpacity(1.0)
      }

    } else if (activeMode === 'Third Person') {
      const isCar = isCarTarget
      const isCrouch = targetActorCtrl?.isCrouching() ?? false
      const minDistance = isCar ? 3.5 : 1.5
      const defaultDist = isCar ? 6.5 : (isCrouch ? 2.8 : 3.5)
      const userDist = Math.max(minDistance, activeKeyframe.distance !== undefined ? activeKeyframe.distance : defaultDist)
      
      // Eye-level camera height: stays near eye/chest level at close distance, elevating naturally at further distance
      const camHeight = isCar
        ? 1.30 + 0.35 * Math.min(2.0, Math.max(0, (userDist - 3.5) / 3.0))
        : (isCrouch ? 1.10 : (1.52 + 0.15 * Math.min(2.0, Math.max(0, (userDist - 1.5) / 2.0))))
      const camDist = -userDist
      const targetYOffset = isCar ? 0.75 : (isCrouch ? 1.10 : 1.52)

      const backOffset = new THREE.Vector3(0, camHeight, camDist).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.smoothedCameraYaw)
      const idealCamPos = charPos.clone().add(backOffset)
      const idealLookAt = new THREE.Vector3(charPos.x, charPos.y + targetYOffset, charPos.z)

      const springResult = this.springArm.evaluate(
        idealLookAt,
        idealCamPos,
        this.clonedEnvGroup,
        dt,
        isHardCut || this.lastCameraMode !== 'Third Person'
      )

      if (this.lastCameraMode !== 'Third Person' || isHardCut) {
        // Hard cut on initial mode change or timeline loop/seek
        this.camera.position.copy(springResult.cameraPosition)
        this.tpvTarget.copy(springResult.targetLookAt)
      } else {
        // Smooth camera follow lerp
        this.camera.position.lerp(springResult.cameraPosition, posLerpFactor)
        this.tpvTarget.lerp(springResult.targetLookAt, posLerpFactor)
      }
      this.camera.lookAt(this.tpvTarget)

      if (this.instancedStageMesh) {
        this.instancedStageMesh.setDitherOpacity(springResult.ditherOpacity)
      }

    } else if (activeMode === 'Wide') {
      const isCar = isCarTarget
      const isCrouch = targetActorCtrl?.isCrouching() ?? false
      const minDistance = isCar ? 3.5 : 1.5
      const defaultDist = isCar ? 18.0 : 16.0
      const dist = Math.max(minDistance, activeKeyframe.distance !== undefined ? activeKeyframe.distance : defaultDist)
      const targetOffsetY = isCar ? 0.75 : (isCrouch ? 1.10 : 1.52)
      const actorCenter = new THREE.Vector3(charPos.x, charPos.y + targetOffsetY, charPos.z)

      // Physical distance-based elevation and offset looking at upper target / head
      const idealCamPos = actorCenter.clone().add(new THREE.Vector3(-dist * 0.7, dist * 0.55, dist * 0.7))

      if (this.lastCameraMode !== 'Wide' || isHardCut) {
        this.wideTarget.copy(actorCenter)
        this.camera.position.copy(idealCamPos)
      } else {
        const wideLerpFactor = 1.0 - Math.exp(-6.0 * Math.max(0.001, dt))
        this.wideTarget.lerp(actorCenter, wideLerpFactor)
        this.camera.position.lerp(idealCamPos, wideLerpFactor)
      }
      this.camera.lookAt(this.wideTarget)

      if (this.instancedStageMesh) {
        this.instancedStageMesh.setDitherOpacity(1.0)
      }

    } else if (activeMode === 'Side') {
      const isCar = isCarTarget
      const isCrouch = targetActorCtrl?.isCrouching() ?? false
      const minDistance = isCar ? 3.5 : 1.5
      const defaultDist = isCar ? 6.5 : 4.5
      const userDist = Math.max(minDistance, activeKeyframe.distance !== undefined ? activeKeyframe.distance : defaultDist)
      
      // Eye-level side profile height
      const camHeight = isCar
        ? 0.90 + 0.30 * Math.min(2.0, Math.max(0, (userDist - 3.5) / 3.0))
        : (isCrouch ? 1.05 : (1.50 + 0.15 * Math.min(2.0, Math.max(0, (userDist - 1.5) / 3.0))))
      const sideVec = isCar
        ? new THREE.Vector3(-userDist, camHeight, 0.0)
        : new THREE.Vector3(-userDist, camHeight, 0.3)
      const targetOffsetY = isCar ? 0.75 : (isCrouch ? 1.10 : 1.52)

      const sideOffset = sideVec.applyAxisAngle(new THREE.Vector3(0, 1, 0), this.smoothedCameraYaw)
      const idealCamPos = charPos.clone().add(sideOffset)
      const idealLookAt = new THREE.Vector3(charPos.x, charPos.y + targetOffsetY, charPos.z)

      const springResult = this.springArm.evaluate(
        idealLookAt,
        idealCamPos,
        this.clonedEnvGroup,
        dt,
        isHardCut || this.lastCameraMode !== 'Side'
      )

      if (this.lastCameraMode !== 'Side' || isHardCut) {
        // Hard cut on initial mode change
        this.camera.position.copy(springResult.cameraPosition)
        this.sideTarget.copy(springResult.targetLookAt)
      } else {
        // Smooth camera follow lerp
        this.camera.position.lerp(springResult.cameraPosition, posLerpFactor)
        this.sideTarget.lerp(springResult.targetLookAt, posLerpFactor)
      }
      this.camera.lookAt(this.sideTarget)

      if (this.instancedStageMesh) {
        this.instancedStageMesh.setDitherOpacity(springResult.ditherOpacity)
      }
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
    this.actorList.forEach(a => a.playbackController.play())
  }

  public pause(): void {
    this.playbackController.pause()
    this.actorList.forEach(a => a.playbackController.pause())
  }

  public stop(): void {
    this.playbackController.stop()
    this.actorList.forEach(a => {
      a.playbackController.stop()
      const firstFrame = a.playbackController.getTrajectory()[0]
      const initialAnim = firstFrame?.anim
      a.controller.resetAnimation(initialAnim)
      a.playbackController.evaluateAt(0, a.controller, 0, true)
    })
    if (this.actorController && this.actorList.length === 0) {
      const firstFrame = this.playbackController.getTrajectory()[0]
      const initialAnim = firstFrame?.anim
      this.actorController.resetAnimation(initialAnim)
      this.playbackController.evaluateAt(0, this.actorController, 0, true)
      this.actorPosition.copy(this.actorController.position)
    }
  }

  public getIsPlaying(): boolean {
    return this.playbackController.getIsPlaying()
  }

  public resetPlayback(): void {
    this.seekToTime(0)
    this.stop()
  }

  public seekToTime(t: number): void {
    const maxDur = this.getDuration()
    const targetT = Math.max(0, Math.min(t, maxDur))
    this.playbackController.setCurrentTime(targetT)
    this.actorList.forEach(a => {
      a.playbackController.setCurrentTime(targetT)
      if (targetT === 0) {
        const firstFrame = a.playbackController.getTrajectory()[0]
        const initialAnim = firstFrame?.anim
        a.controller.resetAnimation(initialAnim)
      }
    })
    if (targetT === 0 && this.actorController && this.actorList.length === 0) {
      const firstFrame = this.playbackController.getTrajectory()[0]
      const initialAnim = firstFrame?.anim
      this.actorController.resetAnimation(initialAnim)
    }
    this.lastCameraMode = null
    this.forceHardCutNextCameraUpdate = true
    this.updateActorMovement(0)
    this.updateCamera()
  }

  public getCurrentTime(): number {
    return this.playbackController.getCurrentTime()
  }

  public getDuration(): number {
    let maxD = 0
    if (this.actorList && this.actorList.length > 0) {
      this.actorList.forEach(a => {
        const dur = a.playbackController.getMaxDuration()
        if (dur > maxD) maxD = dur
      })
    }
    const mainDur = this.playbackController.getMaxDuration()
    if (mainDur > maxD) maxD = mainDur
    return maxD > 0 ? maxD : 7.0
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

    if (this.instancedStageMesh) {
      this.instancedStageMesh.dispose()
      this.instancedStageMesh = null
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
