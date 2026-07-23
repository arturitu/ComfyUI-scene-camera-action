import * as THREE from 'three'
import type { DirectingState, ThreeDirectingOptions } from './types'
import * as config from './threeConfig'

export class ThreeDirecting {
  private container: HTMLElement
  private state: DirectingState
  private onStateChange?: (state: DirectingState) => void

  private scene!: THREE.Scene
  private camera!: THREE.PerspectiveCamera
  private renderer!: THREE.WebGLRenderer
  private characterGroup: THREE.Group | null = null
  private mainLight!: THREE.DirectionalLight
  private gridHelper: THREE.GridHelper | null = null
  private animationId: number | null = null
  private clonedEnvGroup: THREE.Group | null = null
  private connectedThreeActing: any = null

  private playbackTime = 0
  private trajectory: Array<{ t: number; px: number; py: number; pz: number; ry: number }> = []
  private characterPosition = new THREE.Vector3(0, -1.0, 2)
  private wideTarget = new THREE.Vector3(0, 0, 0)
  private lastTime = performance.now()

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
    this.buildSceneEnvironment()
  }

  public loadActingData(actingDataJson: string): void {
    if (!actingDataJson || !actingDataJson.trim()) {
      this.trajectory = []
      return
    }
    try {
      const parsed = JSON.parse(actingDataJson)

      if (Array.isArray(parsed)) {
        this.trajectory = parsed
        this.trajectory.sort((a, b) => a.t - b.t)
      } else if (typeof parsed === 'object') {
        if (Array.isArray(parsed.motion_data)) {
          this.trajectory = parsed.motion_data
          this.trajectory.sort((a, b) => a.t - b.t)
        } else if (typeof parsed.motion_data === 'string' && parsed.motion_data.trim()) {
          try {
            this.trajectory = JSON.parse(parsed.motion_data)
            this.trajectory.sort((a, b) => a.t - b.t)
          } catch {
            this.trajectory = []
          }
        }
        if (parsed.scene_data && !this.connectedThreeActing) {
          this.buildSceneFromData(parsed.scene_data)
        }
      }
    } catch {
      this.trajectory = []
    }

    this.normalizeTrajectoryOrientation()
    this.playbackTime = 0
    this.updateCharacterMovement(0)
    this.updateCamera()
  }

  private normalizeTrajectoryOrientation(): void {
    if (this.trajectory.length < 2) return

    let firstMoveIdx = -1
    for (let i = 1; i < this.trajectory.length; i++) {
      const dx = this.trajectory[i].px - this.trajectory[0].px
      const dz = this.trajectory[i].pz - this.trajectory[0].pz
      if (dx * dx + dz * dz > 0.001 || Math.abs(this.trajectory[i].ry - this.trajectory[0].ry) > 0.001) {
        firstMoveIdx = i
        break
      }
    }

    if (firstMoveIdx > 0) {
      const dx = this.trajectory[firstMoveIdx].px - this.trajectory[0].px
      const dz = this.trajectory[firstMoveIdx].pz - this.trajectory[0].pz
      let initialRy = this.trajectory[firstMoveIdx].ry
      if (dx * dx + dz * dz > 0.001) {
        initialRy = Math.atan2(dx, dz)
      }
      for (let k = 0; k < firstMoveIdx; k++) {
        this.trajectory[k].ry = initialRy
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

    this.camera = new THREE.PerspectiveCamera(50, width / height, 0.1, 100)
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
    this.buildCharacter()

    const resizeObserver = new ResizeObserver(() => { this.onResize() })
    resizeObserver.observe(this.container)
  }

  private buildSceneEnvironment(): void {
    if (this.clonedEnvGroup) {
      this.scene.remove(this.clonedEnvGroup)
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

      let inheritedCharacter: THREE.Group | null = null

      for (const child of sourceScene.children) {
        if (
          child instanceof THREE.Camera ||
          child.name.includes('TransformControls') ||
          child.name.includes('Helper')
        ) continue

        if (child instanceof THREE.GridHelper) {
          hasGrid = true
        }

        if (child.name === 'characterGroup') {
          inheritedCharacter = child.clone(true) as THREE.Group
          continue
        }

        const clone = child.clone(true)
        this.clonedEnvGroup!.add(clone)
      }

      if (inheritedCharacter) {
        if (this.characterGroup) {
          this.scene.remove(this.characterGroup)
        }
        this.characterGroup = inheritedCharacter
        this.characterGroup.position.copy(this.characterPosition)
        this.scene.add(this.characterGroup)
      } else {
        this.buildCharacter()
      }

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

    const frontMat = new THREE.MeshStandardMaterial({ color: 0x3d4974, roughness: 0.4, metalness: 0.1 })
    const topMat = new THREE.MeshStandardMaterial({ color: 0xe6e6e6, roughness: 0.4, metalness: 0.1 })
    const sideMat = new THREE.MeshStandardMaterial({ color: 0xbfbfbf, roughness: 0.4, metalness: 0.1 })
    const materials = [sideMat, sideMat, topMat, sideMat, frontMat, sideMat]

    const transforms: any[] = sceneData.asset_transforms ?? []
    transforms.forEach((t: any) => {
      const geo = new THREE.BoxGeometry(1, 1, 1)
      const mesh = new THREE.Mesh(geo, materials)
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

    // Ensure character exists when building from JSON
    if (!this.characterGroup) {
      this.buildCharacter()
    }
  }

  private buildCharacter(): void {
    if (this.characterGroup) {
      this.scene.remove(this.characterGroup)
    }

    this.characterGroup = new THREE.Group()

    const bodyGeo = new THREE.CapsuleGeometry(0.25, 0.85, 8, 16)
    const bodyMat = new THREE.MeshStandardMaterial({
      color: 0xff007f,
      roughness: 0.2,
      metalness: 0.5,
    })
    const bodyMesh = new THREE.Mesh(bodyGeo, bodyMat)
    bodyMesh.position.y = 0.85
    bodyMesh.castShadow = true
    bodyMesh.receiveShadow = true
    this.characterGroup.add(bodyMesh)

    this.characterGroup.position.copy(this.characterPosition)
    this.scene.add(this.characterGroup)
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

  private updateCharacterMovement(dt: number): void {
    if (!this.characterGroup || this.trajectory.length < 2) return

    if (this.isPlaying) {
      this.playbackTime += dt
    }

    const maxDuration = this.trajectory[this.trajectory.length - 1].t || 8.0

    if (this.playbackTime >= maxDuration) {
      if (this.isRecordingMode) {
        this.playbackTime = maxDuration
        this.isPlaying = false
      } else {
        this.playbackTime = this.playbackTime % maxDuration
      }
    }

    const t = this.playbackTime

    let idxA = 0
    for (let i = 0; i < this.trajectory.length; i++) {
      if (this.trajectory[i].t <= t) idxA = i
      else break
    }
    const idxB = (idxA + 1) % this.trajectory.length
    const frameA = this.trajectory[idxA]
    const frameB = this.trajectory[idxB]

    let factor = 0
    let timeDiff = frameB.t - frameA.t
    if (timeDiff < 0) {
      timeDiff = (maxDuration - frameA.t) + frameB.t
      factor = timeDiff > 0 ? (t - frameA.t) / timeDiff : 0
    } else {
      factor = timeDiff > 0 ? (t - frameA.t) / timeDiff : 0
    }

    this.characterPosition.set(
      frameA.px + (frameB.px - frameA.px) * factor,
      frameA.py + (frameB.py - frameA.py) * factor,
      frameA.pz + (frameB.pz - frameA.pz) * factor
    )

    let diffY = frameB.ry - frameA.ry
    diffY = Math.atan2(Math.sin(diffY), Math.cos(diffY))
    this.characterGroup.rotation.y = frameA.ry + diffY * factor
    this.characterGroup.position.copy(this.characterPosition)
  }

  private lastCameraMode: string | null = null

  private updateCamera(): void {
    if (!this.characterGroup) return

    const charPos = this.characterPosition
    const rotY = this.characterGroup.rotation.y
    const activeMode = this.getActiveKeyframeMode(this.playbackTime)

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
      // Positioned to the side of the character tracking alongside
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

    this.updateCharacterMovement(dt)
    this.updateCamera()

    if (this.characterGroup && this.mainLight) {
      this.mainLight.position.copy(this.characterPosition).add(config.MAIN_LIGHT_OFFSET)
      this.mainLight.target.position.copy(this.characterPosition)
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
    this.updateCharacterMovement(0)
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

      // Temporarily disable fog for crisp overview render without fog haze
      const prevFog = this.scene.fog
      this.scene.fog = null

      // Dedicated stage camera with lower FOV (15°) for telephoto stage overview
      const stageCamera = new THREE.PerspectiveCamera(15, this.camera.aspect, 0.1, 200)
      stageCamera.position.set(-36, 32, 36)
      stageCamera.lookAt(0, 0, 0)
      stageCamera.updateProjectionMatrix()

      // Render stage overview frame
      this.renderer.render(this.scene, stageCamera)

      const canvas = this.renderer.domElement
      canvas.toBlob((blob) => {
        // Restore scene fog and standard camera view
        this.scene.fog = prevFog
        this.renderer.render(this.scene, this.camera)
        if (blob) {
          resolve(blob)
        } else {
          reject(new Error('Failed to generate stage blob'))
        }
      }, 'image/png')
    })
  }

  public resetPlayback(): void {
    this.playbackTime = 0
    this.lastCameraMode = null
    this.updateCharacterMovement(0)
    this.updateCamera()
  }

  public seekToTime(t: number): void {
    const maxDur = this.getDuration()
    this.playbackTime = Math.max(0, Math.min(t, maxDur))
    this.lastCameraMode = null
    this.updateCharacterMovement(0)
    this.updateCamera()
  }

  public getCurrentTime(): number {
    return this.playbackTime
  }

  public getDuration(): number {
    if (this.trajectory.length > 0) {
      return this.trajectory[this.trajectory.length - 1].t || 7.0
    }
    return 7.0
  }

  public dispose(): void {
    if (this.animationId !== null) {
      cancelAnimationFrame(this.animationId)
      this.animationId = null
    }
    this.renderer.dispose()
    this.scene.clear()
  }
}
