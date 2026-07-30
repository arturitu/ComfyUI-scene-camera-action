import * as THREE from 'three'
import type { DirectingState, ThreeDirectingOptions } from './types'
import * as config from './threeConfig'
import { BaseActor } from './actors/BaseActor'
import { ActorFactory } from './actors/ActorFactory'
import { PlaybackController } from './utils/PlaybackController'

export class ThreeDirecting {
  private container: HTMLElement
  private state: DirectingState
  private onStateChange?: (state: DirectingState) => void

  private scene!: THREE.Scene
  private camera!: THREE.PerspectiveCamera
  private renderer!: THREE.WebGLRenderer
  private actorController: BaseActor | null = null
  private mainLight!: THREE.DirectionalLight
  private gridHelper: THREE.GridHelper | null = null
  private animationId: number | null = null
  private clonedEnvGroup: THREE.Group | null = null
  private connectedThreeActing: any = null

  private playbackController = new PlaybackController()
  private actorPosition = new THREE.Vector3(0, -1.0, 2)
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
    if (this.connectedThreeActing && typeof this.connectedThreeActing.getActorType === 'function') {
      const actorType = this.connectedThreeActing.getActorType()
      this.buildActor(actorType)
    }
    this.buildSceneEnvironment()
  }

  public loadActingData(actingDataJson: string): void {
    console.log('[ThreeDirecting] loadActingData called, payload length:', actingDataJson?.length ?? 0)
    if (!actingDataJson || !actingDataJson.trim()) {
      this.playbackController.setTrajectory([])
      return
    }
    try {
      const parsed = JSON.parse(actingDataJson)
      if (typeof parsed === 'object' && parsed !== null) {
        const actorType = parsed.actor_type || parsed.actorType || parsed.char_type
        console.log('[ThreeDirecting] Parsed actor_type:', actorType)
        if (actorType) {
          this.buildActor(actorType)
        }
        if (parsed.scene_data && !this.connectedThreeActing) {
          this.buildSceneFromData(parsed.scene_data)
        }
      }
    } catch (e) {
      console.warn('[ThreeDirecting] JSON parse error in loadActingData:', e)
    }

    this.playbackController.setTrajectory(actingDataJson)
    this.playbackController.start()
    console.log('[ThreeDirecting] Loaded frames count:', this.playbackController.getTrajectory().length, 'maxDuration:', this.playbackController.getMaxDuration())
    if (this.actorController) {
      this.playbackController.evaluateAt(0, this.actorController)
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
    if (this.gridHelper) {
      this.scene.remove(this.gridHelper)
      this.gridHelper = null
    }
    this.mainLight = null as any

    let hasGrid = false

    if (this.connectedThreeActing && typeof this.connectedThreeActing.getScene === 'function') {
      const sourceScene = this.connectedThreeActing.getScene() as THREE.Scene
      this.clonedEnvGroup = new THREE.Group()

      let inheritedActor: THREE.Group | null = null

      for (const child of sourceScene.children) {
        if (
          child instanceof THREE.Camera ||
          child.name.includes('TransformControls') ||
          child.name.includes('Helper')
        ) continue

        if (child instanceof THREE.GridHelper) {
          hasGrid = true
        }

        if (child.name === 'actorGroup' || child.name === 'characterGroup') {
          inheritedActor = child.clone(true) as THREE.Group
          continue
        }

        const clone = child.clone(true)
        this.clonedEnvGroup!.add(clone)
      }

      if (inheritedActor) {
        if (this.actorController) {
          this.scene.remove(this.actorController.group)
          this.actorController.dispose()
        }
        this.actorController = {
          group: inheritedActor,
          position: this.actorPosition,
          rotationY: 0,
          velocity: new THREE.Vector3(),
          isOnGround: true,
          buildMesh: () => {},
          updatePhysics: () => {},
          getType: () => 'human',
          setPosition: (x: number, y: number, z: number, ry: number) => {
            this.actorPosition.set(x, y, z)
            inheritedActor!.position.set(x, y, z)
            inheritedActor!.rotation.set(0, ry, 0)
          },
          applyMotionFrame: (frame: any) => {
            this.actorPosition.set(frame.px ?? 0, frame.py ?? -1.0, frame.pz ?? 0)
            inheritedActor!.position.set(frame.px ?? 0, frame.py ?? -1.0, frame.pz ?? 0)
            const euler = new THREE.Euler(frame.rx ?? 0, frame.ry ?? 0, frame.rz ?? 0, 'YXZ')
            inheritedActor!.quaternion.setFromEuler(euler)
          },
          getMotionState: (t: number) => ({
            t, px: this.actorPosition.x, py: this.actorPosition.y, pz: this.actorPosition.z, rx: 0, ry: 0, rz: 0
          }),
          dispose: () => {
            inheritedActor!.traverse((child) => {
              if (child instanceof THREE.Mesh) {
                child.geometry.dispose()
                if (Array.isArray(child.material)) {
                  child.material.forEach((m) => m.dispose())
                } else {
                  child.material.dispose()
                }
              }
            })
          }
        } as any
        if (this.actorController) {
          this.actorController.setPosition(this.actorPosition.x, this.actorPosition.y, this.actorPosition.z, 0)
          this.scene.add(this.actorController.group)
        }
      } else {
        this.buildActor()
      }

      if (this.clonedEnvGroup) {
        this.clonedEnvGroup.traverse((child) => {
          if (child instanceof THREE.DirectionalLight) {
            this.mainLight = child
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
          }
        })

        this.scene.add(this.clonedEnvGroup)
      }
    }

    if (!hasGrid) {
      this.gridHelper = new THREE.GridHelper(
        config.GRID_SIZE,
        config.GRID_DIVISIONS,
        config.GRID_COLOR_CENTER,
        config.GRID_COLOR_GRID
      )
      this.gridHelper.position.y = -1.0
      this.scene.add(this.gridHelper)
    }
  }

  private buildSceneFromData(sceneData: any): void {
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
    if (this.gridHelper) {
      this.scene.remove(this.gridHelper)
      this.gridHelper = null
    }
    this.mainLight = null as any

    this.clonedEnvGroup = new THREE.Group()

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

    const floorGeo = new THREE.PlaneGeometry(100, 100)
    const floorMat = new THREE.MeshStandardMaterial({
      color: config.FLOOR_COLOR,
      roughness: config.FLOOR_ROUGHNESS,
      metalness: config.FLOOR_METALNESS
    })
    const floorMesh = new THREE.Mesh(floorGeo, floorMat)
    floorMesh.name = 'floor'
    floorMesh.rotation.x = -Math.PI / 2
    floorMesh.position.y = -1.002
    floorMesh.receiveShadow = true
    this.clonedEnvGroup.add(floorMesh)

    const transforms: any[] = sceneData.asset_transforms ?? []
    transforms.forEach((t: any) => {
      const geo = new THREE.BoxGeometry(1, 1, 1)
      const mesh = new THREE.Mesh(geo, config.createBlockMaterial())
      mesh.position.set(t.px ?? 0, t.py ?? 0, t.pz ?? 0)
      mesh.rotation.set(t.rx ?? 0, t.ry ?? 0, t.rz ?? 0)
      mesh.scale.set(t.sx ?? 1, t.sy ?? 1, t.sz ?? 1)
      mesh.castShadow = true
      mesh.receiveShadow = true
      this.clonedEnvGroup!.add(mesh)
    })

    this.scene.add(this.clonedEnvGroup)

    this.gridHelper = new THREE.GridHelper(
      config.GRID_SIZE,
      config.GRID_DIVISIONS,
      config.GRID_COLOR_CENTER,
      config.GRID_COLOR_GRID
    )
    this.gridHelper.position.y = -1.0
    this.scene.add(this.gridHelper)

    // Ensure actor exists when building from JSON
    if (!this.actorController) {
      this.buildActor()
    }
  }

  private buildActor(type?: string): void {
    const charType = type ?? 'human'
    if (this.actorController) {
      this.scene.remove(this.actorController.group)
      this.actorController.dispose()
    }
    this.actorController = ActorFactory.create(charType)
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

    if (activeMode === 'First Person') {
      if (this.camera.fov !== 50) {
        this.camera.fov = 50
        this.camera.updateProjectionMatrix()
      }
      const headPos = new THREE.Vector3(charPos.x, charPos.y + 1.1, charPos.z)
      this.camera.position.copy(headPos)
      const forward = new THREE.Vector3(0, 0, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), rotY)
      this.camera.lookAt(headPos.clone().add(forward))

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

    if (this.actorController && this.mainLight) {
      this.mainLight.position.copy(this.actorPosition).add(config.MAIN_LIGHT_OFFSET)
      this.mainLight.target.position.copy(this.actorPosition)
      this.mainLight.target.updateMatrixWorld()
    }

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
}
