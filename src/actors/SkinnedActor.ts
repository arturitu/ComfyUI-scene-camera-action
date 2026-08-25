import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js'
import { BaseActor, type RampSlopeConfig } from './BaseActor'
import * as config from '../threeConfig'
import type { SpawnPoint } from '../types'

// Module-level static scratch objects to eliminate Garbage Collection allocations per frame
const _tempDir = new THREE.Vector3()
const _tempVecA = new THREE.Vector3()
const _tempVecB = new THREE.Vector3()
const _tempSegment = new THREE.Line3()
const _tempCapsuleBounds = new THREE.Box3()
const _tempEuler = new THREE.Euler()

export interface CachedSkinnedAssets {
  modelScene: THREE.Group
  animations: Map<string, THREE.AnimationClip>
}

const assetsCache = new Map<string, CachedSkinnedAssets>()
const assetsLoadingPromises = new Map<string, Promise<CachedSkinnedAssets>>()

export function loadSkinnedAssets(modelUrl: string, animsUrl: string): Promise<CachedSkinnedAssets> {
  const cacheKey = `${modelUrl}__${animsUrl}`
  const cached = assetsCache.get(cacheKey)
  if (cached) return Promise.resolve(cached)

  const pending = assetsLoadingPromises.get(cacheKey)
  if (pending) return pending

  const loadPromise = (async () => {
    const loader = new GLTFLoader()
    const [modelGltf, animsGltf] = await Promise.all([
      loader.loadAsync(modelUrl),
      loader.loadAsync(animsUrl),
    ])

    const modelScene = modelGltf.scene
    modelScene.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        child.castShadow = true
        child.receiveShadow = true
      }
    })

    const animations = new Map<string, THREE.AnimationClip>()
    animsGltf.animations.forEach((clip) => {
      animations.set(clip.name, clip)
    })

    const assets: CachedSkinnedAssets = { modelScene, animations }
    assetsCache.set(cacheKey, assets)
    return assets
  })()

  assetsLoadingPromises.set(cacheKey, loadPromise)
  return loadPromise
}

export abstract class SkinnedActor extends BaseActor {
  public walkBaseSpeed: number = 2.0
  public sprintBaseSpeed: number = 4.0
  public crouchWalkBaseSpeed: number = 1.0

  protected modelGroup: THREE.Group | null = null
  protected mixer: THREE.AnimationMixer | null = null
  protected animationsMap: Map<string, THREE.AnimationClip> = new Map()
  protected currentAnimationName: string | null = null
  protected currentAction: THREE.AnimationAction | null = null
  protected placeholderMesh: THREE.Mesh | null = null
  protected isDisposed: boolean = false
  protected isUserJumping: boolean = false
  protected airborneTime: number = 0
  protected isCrouchedState: boolean = false
  protected isToggleCrouched: boolean = false
  protected prevKeyCDown: boolean = false
  protected filteredSpeed: number = 0
  protected lastRequestedPlaybackAnim: string | null = null

  // Capsule / Box geometries for wireframe display
  protected standingWireframeGeo!: THREE.BufferGeometry
  protected crouchingWireframeGeo!: THREE.BufferGeometry

  constructor() {
    super()
  }

  // Abstract hooks to be implemented by concrete subclasses (HumanActor, QuadrupedActor)
  abstract getModelUrl(): string
  abstract getAnimationsUrl(): string
  abstract getDefaultIdleAnim(): string
  abstract getDefaultWalkAnim(): string
  abstract getDefaultSprintAnim(): string
  abstract getDefaultCrouchIdleAnim(): string
  abstract getDefaultCrouchWalkAnim(): string
  abstract getDefaultJumpAirAnim(): string

  // Physical collider parameters
  abstract getStandingCapsuleRadius(): number
  abstract getStandingCapsuleHeight(): number
  abstract getCrouchingCapsuleRadius(): number
  abstract getCrouchingCapsuleHeight(): number
  abstract getModelYOffset(): number

  protected isHorizontalCapsule(): boolean {
    return false
  }

  protected createStandingColliderGeometry(): THREE.BufferGeometry {
    const r = this.getStandingCapsuleRadius()
    const h = this.getStandingCapsuleHeight()
    const geo = new THREE.CapsuleGeometry(r, h, 8, 16)
    if (this.isHorizontalCapsule()) {
      geo.rotateX(Math.PI / 2)
    }
    return geo
  }

  protected createCrouchingColliderGeometry(): THREE.BufferGeometry {
    const r = this.getCrouchingCapsuleRadius()
    const h = this.getCrouchingCapsuleHeight()
    const geo = new THREE.CapsuleGeometry(r, h, 8, 16)
    if (this.isHorizontalCapsule()) {
      geo.rotateX(Math.PI / 2)
    }
    return geo
  }

  protected getColliderCenterY(isCrouch: boolean): number {
    const r = isCrouch ? this.getCrouchingCapsuleRadius() : this.getStandingCapsuleRadius()
    const h = isCrouch ? this.getCrouchingCapsuleHeight() : this.getStandingCapsuleHeight()
    return this.isHorizontalCapsule() ? r : (h / 2) + r
  }

  protected shouldInclineOnRamps(): boolean {
    return false
  }

  protected getRampSlopeConfig(): RampSlopeConfig {
    return {
      aheadOffset: 0.8,
      lerpSpeed: 10.0,
      pitchMultiplier: 1.0,
      rollMultiplier: 1.0
    }
  }

  public override isCrouching(): boolean {
    if (this.isCrouchedState) return true
    const anim = (this.currentAnimationName ?? '').toLowerCase()
    return anim.includes('crouch') || anim.includes('sit')
  }

  public getCurrentAnimationName(): string {
    return this.currentAnimationName ?? 'None'
  }

  public override getMotionState(t: number) {
    const frame = super.getMotionState(t)
    frame.anim = this.currentAnimationName ?? this.getDefaultIdleAnim()
    return frame
  }

  public override onPlaybackMotion(
    distMoved: number,
    _diffY: number,
    animName?: string,
    dt: number = 0.016,
    isHardCut: boolean = false
  ): void {
    const frameDt = Math.max(0, dt)
    if (animName && animName !== 'None') {
      this.lastRequestedPlaybackAnim = animName
    }
    const requested = animName || this.lastRequestedPlaybackAnim
    const defaultIdle = this.getDefaultIdleAnim()
    const targetAnim = (requested && this.animationsMap.has(requested)) ? requested : defaultIdle
    let animTimeScale = 1.0

    const instantSpeed = (frameDt > 0 && !isHardCut) ? distMoved / frameDt : 0
    if (targetAnim === this.getDefaultWalkAnim()) {
      animTimeScale = Math.max(0.3, Math.min(2.5, instantSpeed / this.walkBaseSpeed))
    } else if (targetAnim === this.getDefaultSprintAnim()) {
      animTimeScale = Math.max(0.3, Math.min(2.5, instantSpeed / this.sprintBaseSpeed))
    } else if (targetAnim === this.getDefaultCrouchWalkAnim()) {
      animTimeScale = Math.max(0.3, Math.min(2.5, instantSpeed / this.crouchWalkBaseSpeed))
    }

    let fadeDuration = 0.15
    if (isHardCut || frameDt === 0) {
      fadeDuration = 0
    } else if (targetAnim.includes('Jump') || targetAnim === 'Bark') {
      fadeDuration = 0.05
    }
    this.playAnimation(targetAnim, fadeDuration, animTimeScale)

    if (this.mixer) {
      if (frameDt === 0) {
        this.mixer.timeScale = 0
        this.mixer.update(0)
      } else {
        this.mixer.timeScale = 1.0
        this.mixer.update(frameDt)
      }
    }
  }

  public buildMesh(): void {
    this.isDisposed = false

    while (this.group.children.length > 0) {
      this.group.remove(this.group.children[0])
    }
    this.modelGroup = null

    // Wireframe collider visualizer
    this.standingWireframeGeo = this.createStandingColliderGeometry()
    this.crouchingWireframeGeo = this.createCrouchingColliderGeometry()

    const colliderMat = new THREE.MeshBasicMaterial({
      color: 0xff00ff,
      wireframe: true,
      depthTest: false,
      depthWrite: false,
      transparent: true,
      opacity: 0.85,
    })
    this.colliderWireframe = new THREE.Mesh(this.standingWireframeGeo, colliderMat)
    this.colliderWireframe.position.y = this.getColliderCenterY(false)
    this.colliderWireframe.renderOrder = 1000
    this.colliderWireframe.visible = this.showCollider
    this.group.add(this.colliderWireframe)

    const modelUrl = this.getModelUrl()
    const animsUrl = this.getAnimationsUrl()
    const cacheKey = `${modelUrl}__${animsUrl}`
    const cached = assetsCache.get(cacheKey)

    if (cached) {
      this.setupSkinnedModel(cached)
    } else {
      // Temporary placeholder mesh while GLTF loads asynchronously for the first time
      const placeholderGeo = this.createStandingColliderGeometry()
      const placeholderMat = new THREE.MeshStandardMaterial({
        color: 0xff007f,
        roughness: 0.4,
        metalness: 0.1,
        transparent: true,
        opacity: 0.3,
      })
      this.placeholderMesh = new THREE.Mesh(placeholderGeo, placeholderMat)
      this.placeholderMesh.position.y = this.getColliderCenterY(false)
      this.group.add(this.placeholderMesh)

      loadSkinnedAssets(modelUrl, animsUrl)
        .then((assets) => {
          this.setupSkinnedModel(assets)
        })
        .catch((err) => {
          console.error(`Failed to load ${this.getType()} GLTF assets:`, err)
        })
    }
  }

  public override actorColor: string = '#F1DFBF'

  public override setActorColor(hexColor: string): void {
    if (!hexColor) return
    this.actorColor = hexColor
    this.applyColorToMesh(hexColor)
  }

  protected applyColorToMesh(hexColor: string): void {
    if (this.placeholderMesh && this.placeholderMesh.material) {
      (this.placeholderMesh.material as THREE.MeshStandardMaterial).color.set(hexColor)
    }
    if (this.modelGroup) {
      const c = new THREE.Color(hexColor)
      this.modelGroup.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
          const mesh = child as THREE.Mesh
          if (Array.isArray(mesh.material)) {
            mesh.material.forEach((mat: any) => {
              if (mat && mat.color) {
                mat.color.copy(c)
                mat.needsUpdate = true
              }
            })
          } else if (mesh.material && (mesh.material as any).color) {
            ;(mesh.material as any).color.copy(c)
            ;(mesh.material as any).needsUpdate = true
          }
        }
      })
    }
  }

  protected setupSkinnedModel(assets: CachedSkinnedAssets): void {
    if (this.isDisposed) return

    // Remove placeholder mesh if present
    if (this.placeholderMesh) {
      this.group.remove(this.placeholderMesh)
      this.placeholderMesh.geometry.dispose()
      ;(this.placeholderMesh.material as THREE.Material).dispose()
      this.placeholderMesh = null
    }

    // Remove existing modelGroup if present
    if (this.modelGroup) {
      this.group.remove(this.modelGroup)
      this.modelGroup = null
    }

    // Clone skinned mesh structure
    const clonedModel = SkeletonUtils.clone(assets.modelScene) as THREE.Group
    clonedModel.position.y = this.getModelYOffset()

    // Clone materials so each actor instance has its own unique materials
    clonedModel.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh
        if (Array.isArray(mesh.material)) {
          mesh.material = mesh.material.map((m) => m.clone())
        } else if (mesh.material) {
          mesh.material = mesh.material.clone()
        }
      }
    })

    this.modelGroup = clonedModel
    this.group.add(this.modelGroup)

    // Apply actor color
    this.applyColorToMesh(this.actorColor)

    // Setup Animation Mixer & Map
    this.animationsMap = assets.animations
    this.mixer = new THREE.AnimationMixer(this.modelGroup)

    // Start default or last requested animation
    const initialAnim = this.lastRequestedPlaybackAnim || this.getDefaultIdleAnim()
    this.playAnimation(initialAnim, 0)
  }

  public override resetToOrigin(sp?: SpawnPoint): void {
    super.resetToOrigin(sp)
    this.filteredSpeed = 0
    this.isUserJumping = false
    this.airborneTime = 0
    this.isToggleCrouched = false
    this.prevKeyCDown = false
    this.isCrouchedState = false
    if (this.mixer) {
      this.mixer.stopAllAction()
    }
    this.currentAnimationName = null
    this.currentAction = null
    this.playAnimation(this.getDefaultIdleAnim(), 0)
  }

  public override resetAnimation(initialAnim?: string): void {
    this.filteredSpeed = 0
    if (this.mixer) {
      this.mixer.stopAllAction()
    }
    this.currentAnimationName = null
    this.currentAction = null
    if (initialAnim && initialAnim !== 'None') {
      this.lastRequestedPlaybackAnim = initialAnim
    }
    const defaultIdle = this.getDefaultIdleAnim()
    const targetAnim = (initialAnim && this.animationsMap.has(initialAnim))
      ? initialAnim
      : (this.lastRequestedPlaybackAnim || defaultIdle)
    this.playAnimation(targetAnim, 0)
  }

  protected playAnimation(animName: string, fadeDuration = 0.15, timeScale = 1.0, loopOnce = false): void {
    if (!this.mixer) return

    if (this.currentAnimationName === animName) {
      if (this.currentAction) {
        this.currentAction.timeScale = timeScale
      }
      return
    }

    const clip = this.animationsMap.get(animName)
    if (!clip) return

    const prevAction = this.currentAction
    const newAction = this.mixer.clipAction(clip)

    newAction.enabled = true
    newAction.timeScale = timeScale
    if (loopOnce) {
      newAction.setLoop(THREE.LoopOnce, 1)
      newAction.clampWhenFinished = true
    } else {
      newAction.setLoop(THREE.LoopRepeat, Infinity)
      newAction.clampWhenFinished = false
    }

    if (prevAction && prevAction !== newAction && fadeDuration > 0) {
      newAction.reset()
      newAction.setEffectiveTimeScale(timeScale)
      newAction.setEffectiveWeight(1.0)
      newAction.crossFadeFrom(prevAction, fadeDuration, true)
      newAction.play()
    } else {
      if (prevAction && prevAction !== newAction) {
        prevAction.stop()
        prevAction.setEffectiveWeight(0)
      }
      newAction.reset()
      newAction.setEffectiveTimeScale(timeScale)
      newAction.setEffectiveWeight(1.0)
      newAction.play()
    }

    this.currentAction = newAction
    this.currentAnimationName = animName
    this.mixer.update(0.001)
  }

  // Hook for subclass-specific animation overrides (e.g. Quadruped 'Bark')
  protected getCustomActionAnimation(_keysPressed: Record<string, boolean>): string | null {
    return null
  }

  public updatePhysics(
    dt: number,
    keysPressed: Record<string, boolean>,
    speedMultiplier: number,
    colliderBVH: any,
    camera?: THREE.Camera
  ): void {
    const isW = keysPressed['ArrowUp'] || keysPressed['KeyW']
    const isS = keysPressed['ArrowDown'] || keysPressed['KeyS']
    const isA = keysPressed['ArrowLeft'] || keysPressed['KeyA']
    const isD = keysPressed['ArrowRight'] || keysPressed['KeyD']
    const isSpace = keysPressed['Space'] || keysPressed[' '] || keysPressed['KeyJ']
    const isShift = Boolean(keysPressed['ShiftLeft'] || keysPressed['ShiftRight'] || keysPressed['Shift'])
    const isMoving = Boolean(isW || isS || isA || isD)

    // Toggle crouch / sit on C key press
    const isKeyCDown = Boolean(keysPressed['KeyC'] || keysPressed['Keyc'] || keysPressed['c'] || keysPressed['C'])
    if (isKeyCDown && !this.prevKeyCDown) {
      this.isToggleCrouched = !this.isToggleCrouched
    }
    this.prevKeyCDown = isKeyCDown

    // Auto-exit crouch/sit if user attempts to walk, run, or jump
    if (this.isToggleCrouched && (isMoving || isSpace)) {
      this.isToggleCrouched = false
    }

    const isCrouch = this.isToggleCrouched
    this.isCrouchedState = isCrouch

    // Jump takeoff trigger
    if (isSpace && this.isOnGround) {
      this.jump()
      this.isUserJumping = true
      this.isOnGround = false
    }

    // Determine movement speed factor
    let movementSpeedFactor = 1.0
    if (isCrouch) {
      movementSpeedFactor = 0.45
    } else if (isShift && isMoving) {
      movementSpeedFactor = 1.6
    }

    const physicsSteps = 5
    const stepDt = dt / physicsSteps
    const speed = (speedMultiplier * 0.5) * movementSpeedFactor

    _tempDir.set(0, 0, 0)

    if (camera) {
      const camFwd = new THREE.Vector3(0, 0, -1)
      const camRight = new THREE.Vector3(1, 0, 0)
      camera.getWorldDirection(camFwd)
      camFwd.y = 0
      camFwd.normalize()
      camRight.crossVectors(camFwd, new THREE.Vector3(0, 1, 0)).normalize()

      if (isW) _tempDir.add(camFwd)
      if (isS) _tempDir.sub(camFwd)
      if (isD) _tempDir.add(camRight)
      if (isA) _tempDir.sub(camRight)
    } else {
      let moveZ = 0
      let moveX = 0
      if (isW) moveZ -= 1
      if (isS) moveZ += 1
      if (isA) moveX -= 1
      if (isD) moveX += 1
      _tempDir.set(moveX, 0, moveZ)
    }

    if (_tempDir.lengthSq() > 0) {
      _tempDir.normalize()
      const targetRotationY = Math.atan2(_tempDir.x, _tempDir.z)

      let diff = targetRotationY - this.rotationY
      while (diff < -Math.PI) diff += Math.PI * 2
      while (diff > Math.PI) diff -= Math.PI * 2

      const dynamicTurnSpeed = 6.5 + (speed * 2.0)
      const lerpFactor = 1.0 - Math.exp(-dynamicTurnSpeed * Math.max(0.001, dt))
      this.rotationY += diff * lerpFactor

      while (this.rotationY < -Math.PI) this.rotationY += Math.PI * 2
      while (this.rotationY > Math.PI) this.rotationY -= Math.PI * 2

      const facingDirX = Math.sin(this.rotationY)
      const facingDirZ = Math.cos(this.rotationY)
      const facingBlend = Math.min(0.75, 0.2 + (speed * 0.1))

      const moveDirX = THREE.MathUtils.lerp(_tempDir.x, facingDirX, facingBlend)
      const moveDirZ = THREE.MathUtils.lerp(_tempDir.z, facingDirZ, facingBlend)

      this.velocity.x = moveDirX * speed
      this.velocity.z = moveDirZ * speed
    } else {
      this.velocity.x = 0
      this.velocity.z = 0
    }

    // Dynamic collider capsule dimensions
    const standingR = this.getStandingCapsuleRadius()
    const standingH = this.getStandingCapsuleHeight()
    const crouchR = this.getCrouchingCapsuleRadius()
    const crouchH = this.getCrouchingCapsuleHeight()

    const activeR = isCrouch ? crouchR : standingR
    const activeH = isCrouch ? crouchH : standingH
    const isHorizontal = this.isHorizontalCapsule()

    if (this.colliderWireframe instanceof THREE.Mesh) {
      this.colliderWireframe.geometry = isCrouch ? this.crouchingWireframeGeo : this.standingWireframeGeo
      this.colliderWireframe.position.y = this.getColliderCenterY(isCrouch)
    }

    const forwardX = Math.sin(this.rotationY)
    const forwardZ = Math.cos(this.rotationY)

    for (let step = 0; step < physicsSteps; step++) {
      if (this.isOnGround) {
        this.velocity.y = -30.0 * stepDt
      } else {
        this.velocity.y -= 30.0 * stepDt
      }
      this.position.addScaledVector(this.velocity, stepDt)

      if (colliderBVH) {
        _tempSegment.start.copy(this.position)
        _tempSegment.start.y += activeR
        _tempSegment.end.copy(this.position)
        _tempSegment.end.y += activeR + activeH

        _tempCapsuleBounds.min.set(this.position.x - 1.5, this.position.y - 0.5, this.position.z - 1.5)
        _tempCapsuleBounds.max.set(this.position.x + 1.5, this.position.y + activeH + 1.5, this.position.z + 1.5)

        this.isOnGround = false

        colliderBVH.shapecast({
          intersectsBounds: (box: THREE.Box3) => box.intersectsBox(_tempCapsuleBounds),
          intersectsTriangle: (tri: any) => {
            const distSq = tri.closestPointToSegment(_tempSegment, _tempVecA, _tempVecB)
            if (distSq < activeR * activeR) {
              const dist = Math.sqrt(distSq)
              const depth = activeR - dist
              _tempDir.subVectors(_tempVecB, _tempVecA).normalize()

              _tempSegment.start.addScaledVector(_tempDir, depth)
              _tempSegment.end.addScaledVector(_tempDir, depth)
            }
          }
        })

        _tempVecA.copy(this.position)
        this.position.copy(_tempSegment.start)
        this.position.y -= activeR

        _tempVecB.subVectors(this.position, _tempVecA)
        const deltaLen = _tempVecB.length()
        if (deltaLen > 0.00001) {
          const normalY = _tempVecB.y / deltaLen
          if (_tempVecB.y > 0 && normalY > 0.25) {
            this.isOnGround = true
          }
        }

        if (this.isOnGround && this.velocity.y <= 0) {
          this.velocity.y = 0
          this.isUserJumping = false
          this.airborneTime = 0
        } else {
          this.airborneTime += stepDt
          if (this.airborneTime > 0.35 && this.velocity.y < -3.0) {
            this.isUserJumping = true
          }
        }
      } else {
        if (this.position.y <= config.GROUND_Y) {
          this.position.y = config.GROUND_Y
          this.velocity.y = 0
          this.isOnGround = true
          this.isUserJumping = false
          this.airborneTime = 0
        } else {
          this.isOnGround = false
        }
      }
    }

    if (this.position.y < -10.0) {
      this.resetToOrigin()
      return
    }

    this.group.position.copy(this.position)

    if (this.shouldInclineOnRamps()) {
      this.updateSlopeOrientation(dt, colliderBVH, 15.0)
    } else {
      _tempEuler.set(0, this.rotationY, 0, 'YXZ')
      this.group.quaternion.setFromEuler(_tempEuler)
    }

    // Select active animation
    let targetAnimation = this.getDefaultIdleAnim()
    let animTimeScale = 1.0

    const customAction = this.getCustomActionAnimation(keysPressed)
    if (customAction && this.animationsMap.has(customAction)) {
      targetAnimation = customAction
      animTimeScale = 1.0
    } else if (this.isUserJumping && !this.isOnGround) {
      targetAnimation = this.getDefaultJumpAirAnim()
      animTimeScale = 1.0
    } else if (isCrouch) {
      if (isMoving) {
        targetAnimation = this.getDefaultCrouchWalkAnim()
        animTimeScale = Math.max(0.2, speed / this.crouchWalkBaseSpeed)
      } else {
        targetAnimation = this.getDefaultCrouchIdleAnim()
        animTimeScale = 1.0
      }
    } else if (isMoving) {
      if (isShift) {
        targetAnimation = this.getDefaultSprintAnim()
        animTimeScale = Math.max(0.2, speed / this.sprintBaseSpeed)
      } else {
        targetAnimation = this.getDefaultWalkAnim()
        animTimeScale = Math.max(0.2, speed / this.walkBaseSpeed)
      }
    } else {
      targetAnimation = this.getDefaultIdleAnim()
      animTimeScale = 1.0
    }

    let fadeDuration = 0.15
    if (targetAnimation.includes('Jump') || targetAnimation === 'Bark') {
      fadeDuration = 0.05
    }
    this.playAnimation(targetAnimation, fadeDuration, animTimeScale)

    if (this.mixer) {
      this.mixer.update(dt)
    }
  }

  public override dispose(): void {
    this.isDisposed = true
    if (this.mixer) {
      this.mixer.stopAllAction()
      this.mixer = null
    }
    if (this.standingWireframeGeo) {
      this.standingWireframeGeo.dispose()
    }
    if (this.crouchingWireframeGeo) {
      this.crouchingWireframeGeo.dispose()
    }
    this.modelGroup = null
    super.dispose()
  }
}
