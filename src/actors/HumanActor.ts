import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js'
import { BaseActor } from './BaseActor'
import * as config from '../threeConfig'

import humanCubesGlb from '../assets/models/human-cubes-rigged.glb'
import humanAnimsGlb from '../assets/models/human-animations.glb'

// Module-level static scratch objects to eliminate Garbage Collection allocations per frame
const _tempDir = new THREE.Vector3()
const _tempVecA = new THREE.Vector3()
const _tempVecB = new THREE.Vector3()
const _tempSegment = new THREE.Line3()
const _tempCapsuleBounds = new THREE.Box3()
const _tempRay = new THREE.Ray()

interface CachedHumanAssets {
  modelScene: THREE.Group
  animations: Map<string, THREE.AnimationClip>
}

let cachedAssets: CachedHumanAssets | null = null
let assetsCachePromise: Promise<CachedHumanAssets> | null = null

function loadHumanAssets(): Promise<CachedHumanAssets> {
  if (cachedAssets) return Promise.resolve(cachedAssets)
  if (assetsCachePromise) return assetsCachePromise

  assetsCachePromise = (async () => {
    const loader = new GLTFLoader()
    const [modelGltf, animsGltf] = await Promise.all([
      loader.loadAsync(humanCubesGlb),
      loader.loadAsync(humanAnimsGlb),
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

    cachedAssets = { modelScene, animations }
    return cachedAssets
  })()

  return assetsCachePromise
}

export class HumanActor extends BaseActor {
  public static walkBaseSpeed: number = 2.0
  public static sprintBaseSpeed: number = 4.0
  public static crouchWalkBaseSpeed: number = 1.0

  public walkBaseSpeed: number = HumanActor.walkBaseSpeed
  public sprintBaseSpeed: number = HumanActor.sprintBaseSpeed
  public crouchWalkBaseSpeed: number = HumanActor.crouchWalkBaseSpeed

  private modelGroup: THREE.Group | null = null
  private mixer: THREE.AnimationMixer | null = null
  private animationsMapMap: Map<string, THREE.AnimationClip> = new Map()
  private currentAnimationName: string | null = null
  private currentAction: THREE.AnimationAction | null = null
  private placeholderMesh: THREE.Mesh | null = null
  private lastPlaybackTime: number = 0
  private isDisposed: boolean = false
  private isUserJumping: boolean = false
  private airborneTime: number = 0

  // Wireframe collider geometries for standing (2.20m total height) and crouching (1.40m total height)
  private standingWireframeGeo: THREE.CapsuleGeometry = new THREE.CapsuleGeometry(0.25, 1.70, 8, 16)
  private crouchingWireframeGeo: THREE.CapsuleGeometry = new THREE.CapsuleGeometry(0.25, 0.90, 8, 16)

  constructor() {
    super()
    this.buildMesh()
  }

  public getType(): 'human' {
    return 'human'
  }

  public getCurrentAnimationName(): string {
    return this.currentAnimationName ?? 'None'
  }

  private filteredSpeed: number = 0

  public override getMotionState(t: number) {
    const frame = super.getMotionState(t)
    frame.anim = this.currentAnimationName ?? 'Idle_A'
    return frame
  }

  public override onPlaybackMotion(distMoved: number, _diffY: number, animName?: string, dt: number = 0.016): void {
    const frameDt = Math.max(0, dt)
    let targetAnim = 'Idle_A'
    let animTimeScale = 1.0

    if (animName && animName !== 'None' && this.animationsMapMap.has(animName)) {
      targetAnim = animName
      const instantSpeed = frameDt > 0 ? distMoved / frameDt : 0
      if (targetAnim === 'Walk') {
        animTimeScale = Math.max(0.3, Math.min(2.5, instantSpeed / this.walkBaseSpeed))
      } else if (targetAnim === 'Sprint') {
        animTimeScale = Math.max(0.3, Math.min(2.5, instantSpeed / this.sprintBaseSpeed))
      } else if (targetAnim === 'Crouch_Walk') {
        animTimeScale = Math.max(0.3, Math.min(2.5, instantSpeed / this.crouchWalkBaseSpeed))
      }
    } else {
      // Fallback smooth speed calculation with hysteresis for legacy recordings
      const instantSpeed = frameDt > 0 ? distMoved / frameDt : 0
      this.filteredSpeed += (instantSpeed - this.filteredSpeed) * 0.25

      if (this.filteredSpeed > 2.5) {
        targetAnim = 'Sprint'
        animTimeScale = Math.max(0.3, this.filteredSpeed / this.sprintBaseSpeed)
      } else if (this.filteredSpeed > 0.15) {
        targetAnim = 'Walk'
        animTimeScale = Math.max(0.3, this.filteredSpeed / this.walkBaseSpeed)
      } else if (this.currentAnimationName === 'Walk' || this.currentAnimationName === 'Sprint') {
        if (this.filteredSpeed > 0.08) {
          targetAnim = this.currentAnimationName
        }
      }
    }

    this.playAnimation(targetAnim, 0.2, animTimeScale)

    if (this.mixer && frameDt > 0) {
      this.mixer.update(frameDt)
    }
  }

  public buildMesh(): void {
    this.isDisposed = false

    while (this.group.children.length > 0) {
      this.group.remove(this.group.children[0])
    }
    this.modelGroup = null

    // Collider Wireframe Visualizer (matches 2.20m human height, radius 0.25, height 1.70)
    const colliderMat = new THREE.MeshBasicMaterial({
      color: 0xff00ff,
      wireframe: true,
      depthTest: false,
      depthWrite: false,
      transparent: true,
      opacity: 0.85,
    })
    this.colliderWireframe = new THREE.Mesh(this.standingWireframeGeo, colliderMat)
    this.colliderWireframe.position.y = 1.10
    this.colliderWireframe.renderOrder = 1000
    this.colliderWireframe.visible = this.showCollider
    this.group.add(this.colliderWireframe)

    if (cachedAssets) {
      this.setupHumanModel(cachedAssets)
    } else {
      // Temporary placeholder mesh while GLTF loads asynchronously for the first time
      const bodyGeo = new THREE.CapsuleGeometry(0.25, 1.20, 8, 16)
      const bodyMat = new THREE.MeshStandardMaterial({
        color: 0xff007f,
        roughness: 0.4,
        metalness: 0.1,
        transparent: true,
        opacity: 0.3,
      })
      this.placeholderMesh = new THREE.Mesh(bodyGeo, bodyMat)
      this.placeholderMesh.position.y = 0.85
      this.group.add(this.placeholderMesh)

      loadHumanAssets()
        .then((assets) => {
          this.setupHumanModel(assets)
        })
        .catch((err) => {
          console.error('Failed to load HumanActor GLTF assets:', err)
        })
    }
  }

  private setupHumanModel(assets: CachedHumanAssets): void {
    if (this.isDisposed) return

    // Remove placeholder mesh if present
    if (this.placeholderMesh) {
      this.group.remove(this.placeholderMesh)
      this.placeholderMesh.geometry.dispose()
        ; (this.placeholderMesh.material as THREE.Material).dispose()
      this.placeholderMesh = null
    }

    // Remove existing modelGroup if present to avoid duplicate meshes / z-fighting
    if (this.modelGroup) {
      this.group.remove(this.modelGroup)
      this.modelGroup = null
    }

    // Clone skinned mesh structure
    const clonedModel = SkeletonUtils.clone(assets.modelScene) as THREE.Group
    // Elevate model slightly so feet soles sit flush on the floor Y = 0
    clonedModel.position.y = 0.01

    this.modelGroup = clonedModel
    this.group.add(this.modelGroup)

    // Setup Animation Mixer & Map
    this.animationsMapMap = assets.animations
    this.mixer = new THREE.AnimationMixer(this.modelGroup)

    // Start default animation
    this.playAnimation('Idle_A', 0)
  }

  public override resetToOrigin(): void {
    super.resetToOrigin()
    this.filteredSpeed = 0
    this.isUserJumping = false
    this.airborneTime = 0
    this.currentAnimationName = null
    this.currentAction = null
    this.playAnimation('Idle_A', 0)
  }

  public override resetAnimation(initialAnim?: string): void {
    this.filteredSpeed = 0
    this.currentAnimationName = null
    const targetAnim = (initialAnim && this.animationsMapMap.has(initialAnim)) ? initialAnim : 'Idle_A'
    this.playAnimation(targetAnim, 0)
  }

  private playAnimation(animName: string, fadeDuration = 0.2, timeScale = 1.0, loopOnce = false): void {
    if (!this.mixer) return

    if (this.currentAnimationName === animName) {
      if (this.currentAction) {
        this.currentAction.timeScale = timeScale
      }
      return
    }

    const clip = this.animationsMapMap.get(animName)
    if (!clip) return

    const newAction = this.mixer.clipAction(clip)

    if (this.currentAction && this.currentAction !== newAction) {
      this.currentAction.fadeOut(fadeDuration)
    }

    newAction.reset()
    if (loopOnce) {
      newAction.setLoop(THREE.LoopOnce, 1)
      newAction.clampWhenFinished = true
    } else {
      newAction.setLoop(THREE.LoopRepeat, Infinity)
      newAction.clampWhenFinished = false
    }

    newAction.fadeIn(fadeDuration)
    newAction.timeScale = timeScale
    newAction.play()

    this.currentAction = newAction
    this.currentAnimationName = animName
  }

  public updatePhysics(
    dt: number,
    keysPressed: Record<string, boolean>,
    speedMultiplier: number,
    colliderBVH: any
  ): void {
    const isW = keysPressed['ArrowUp'] || keysPressed['KeyW']
    const isS = keysPressed['ArrowDown'] || keysPressed['KeyS']
    const isA = keysPressed['ArrowLeft'] || keysPressed['KeyA']
    const isD = keysPressed['ArrowRight'] || keysPressed['KeyD']
    const isSpace = keysPressed['Space'] || keysPressed[' '] || keysPressed['KeyJ']
    const isShift = Boolean(keysPressed['ShiftLeft'] || keysPressed['ShiftRight'] || keysPressed['Shift'])
    const isCrouch = Boolean(keysPressed['KeyC'])

    // Jump takeoff trigger
    if (isSpace && this.isOnGround) {
      this.jump()
      this.isUserJumping = true
      this.isOnGround = false
    }

    const isMoving = isW || isS || isA || isD

    // Determine movement speed multiplier based on crouch or sprint
    let movementSpeedFactor = 1.0
    if (isCrouch) {
      movementSpeedFactor = 0.45
    } else if (isShift && isMoving) {
      movementSpeedFactor = 1.6
    }

    const physicsSteps = 5
    const stepDt = dt / physicsSteps
    const speed = (speedMultiplier * 0.5) * movementSpeedFactor

    let moveZ = 0
    let moveX = 0

    if (isW) moveZ -= 1
    if (isS) moveZ += 1
    if (isA) moveX -= 1
    if (isD) moveX += 1

    _tempDir.set(moveX, 0, moveZ)
    if (_tempDir.lengthSq() > 0) {
      _tempDir.normalize()
      this.rotationY = Math.atan2(_tempDir.x, _tempDir.z)
      this.group.rotation.y = this.rotationY
    }

    this.velocity.x = _tempDir.x * speed
    this.velocity.z = _tempDir.z * speed

    // Dynamically adjust collider capsule dimensions based on standing vs crouching
    const radius = 0.25
    const height = isCrouch ? 0.90 : 1.70

    if (this.colliderWireframe instanceof THREE.Mesh) {
      this.colliderWireframe.geometry = isCrouch ? this.crouchingWireframeGeo : this.standingWireframeGeo
      this.colliderWireframe.position.y = (height / 2) + radius
    }

    let touchGround = false

    for (let step = 0; step < physicsSteps; step++) {
      this.velocity.y -= 30 * stepDt
      this.position.addScaledVector(this.velocity, stepDt)

      if (colliderBVH) {
        _tempSegment.start.copy(this.position)
        _tempSegment.start.y += radius
        _tempSegment.end.copy(this.position)
        _tempSegment.end.y += radius + height

        const totalCapsuleHeight = height + (2 * radius)
        _tempCapsuleBounds.min.set(this.position.x - 0.8, this.position.y - 0.5, this.position.z - 0.8)
        _tempCapsuleBounds.max.set(
          this.position.x + 0.8,
          this.position.y + totalCapsuleHeight + 0.8,
          this.position.z + 0.8
        )

        colliderBVH.shapecast({
          intersectsBounds: (box: THREE.Box3) => box.intersectsBox(_tempCapsuleBounds),
          intersectsTriangle: (tri: any) => {
            const distSq = tri.closestPointToSegment(_tempSegment, _tempVecA, _tempVecB)
            const dist = Math.sqrt(distSq)

            const contactMargin = 0.02
            if (dist < radius + contactMargin) {
              const depth = radius - dist
              const direction = _tempVecB.clone().sub(_tempVecA).normalize()
              if (direction.y > 0.3 || _tempVecA.y <= this.position.y + 0.1) {
                touchGround = true
              }
              if (depth > 0) {
                _tempSegment.start.addScaledVector(direction, depth)
                _tempSegment.end.addScaledVector(direction, depth)
              }
            }
          },
        })

        this.position.copy(_tempSegment.start)
        this.position.y -= radius

        if (touchGround && this.velocity.y <= 0) {
          this.velocity.y = 0
          this.isOnGround = true
        }

        // Downward Slope / Cuesta Snapping:
        // When running down a ramp/slope, snap position down to surface if feet float slightly above
        if (!touchGround && this.velocity.y <= 0) {
          _tempRay.origin.set(this.position.x, this.position.y + 0.5, this.position.z)
          _tempRay.direction.set(0, -1, 0)
          const hit = colliderBVH.raycastFirst(_tempRay)
          if (hit && hit.distance < 0.95 && hit.face && hit.face.normal.y > 0.3) {
            const slopeY = hit.point.y
            if (this.position.y >= slopeY && this.position.y - slopeY < 0.45) {
              this.position.y = slopeY
              this.velocity.y = 0
              this.isOnGround = true
              touchGround = true
            }
          }
        }
      }

      // Hard floor boundary at Y=0: Actor can NEVER sink below ground level
      if (this.position.y <= config.GROUND_Y) {
        this.position.y = config.GROUND_Y
        if (this.velocity.y < 0) this.velocity.y = 0
        this.isOnGround = true
        touchGround = true
      }
    }

    if (touchGround) {
      this.isOnGround = true
      this.isUserJumping = false
      this.airborneTime = 0
    } else if (colliderBVH) {
      this.isOnGround = false
      this.airborneTime += dt
      // Only set jumping if falling down a high ledge/cliff for >0.35s
      if (this.airborneTime > 0.35 && this.velocity.y < -3.0) {
        this.isUserJumping = true
      }
    }

    if (this.position.y < -10.0) {
      this.resetToOrigin()
      return
    }

    this.group.position.copy(this.position)

    // Select active animation phase
    let targetAnimation = 'Idle_A'
    let animTimeScale = 1.0

    // Only play Jump_air if user explicitly pressed Jump or fell off a high cliff
    if (this.isUserJumping && !this.isOnGround) {
      targetAnimation = 'Jump_air'
      animTimeScale = 1.0
    } else if (isCrouch) {
      if (isMoving) {
        targetAnimation = 'Crouch_Walk'
        animTimeScale = Math.max(0.2, speed / this.crouchWalkBaseSpeed)
      } else {
        targetAnimation = 'Crouch_Idle'
        animTimeScale = 1.0
      }
    } else if (isMoving) {
      if (isShift) {
        targetAnimation = 'Sprint'
        animTimeScale = Math.max(0.2, speed / this.sprintBaseSpeed)
      } else {
        targetAnimation = 'Walk'
        animTimeScale = Math.max(0.2, speed / this.walkBaseSpeed)
      }
    } else {
      targetAnimation = 'Idle_A'
      animTimeScale = 1.0
    }

    this.playAnimation(targetAnimation, 0.2, animTimeScale)

    // Advance animation mixer
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
    this.standingWireframeGeo.dispose()
    this.crouchingWireframeGeo.dispose()
    this.modelGroup = null
    super.dispose()
  }
}
