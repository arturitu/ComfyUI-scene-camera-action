import * as THREE from 'three'
import type { MotionFrame, SpawnPoint } from '../types'
import * as config from '../threeConfig'

// Static scratch instances to avoid per-frame GC allocations
const _tempEuler = new THREE.Euler()
const _tempRay = new THREE.Ray()
const _tempNormal = new THREE.Vector3()
const _tempHitPoint = new THREE.Vector3()
const _tempFlatFwd = new THREE.Vector3()
const _tempUp = new THREE.Vector3()
const _tempSlopeRight = new THREE.Vector3()
const _tempSlopeFwd = new THREE.Vector3()
const _tempBasisMat = new THREE.Matrix4()
const _tempTargetQuat = new THREE.Quaternion()

export interface RampSlopeConfig {
  aheadOffset?: number
  rayOriginHeight?: number
  maxRayDistance?: number
  minNormalY?: number
  clampThreshold?: number
  lerpSpeed?: number
  airborneDecay?: number
  pitchMultiplier?: number
  rollMultiplier?: number
}

export abstract class BaseActor {
  public group: THREE.Group
  public position: THREE.Vector3 = new THREE.Vector3(0, config.GROUND_Y, 2)
  public velocity: THREE.Vector3 = new THREE.Vector3(0, 0, 0)
  public rotationY: number = config.DEFAULT_ACTOR_ROTATION_Y
  public rampPitchAngle: number = 0
  public rampRollAngle: number = 0
  public isOnGround: boolean = true
  public colliderWireframe: THREE.Object3D | null = null
  public showCollider: boolean = false

  public lastSpawnPoint?: SpawnPoint
  public actorColor: string = '#F1DFBF'

  public setActorColor(hexColor: string): void {
    if (!hexColor) return
    this.actorColor = hexColor
  }

  constructor() {
    this.group = new THREE.Group()
    this.group.name = 'actorGroup'
    this.group.position.copy(this.position)
    this.group.rotation.y = this.rotationY
  }

  public resetToOrigin(sp?: SpawnPoint): void {
    if (sp) {
      this.lastSpawnPoint = sp
    }
    const targetSp = sp || this.lastSpawnPoint
    const px = targetSp?.px ?? 0
    const py = targetSp?.py ?? config.GROUND_Y
    const pz = targetSp?.pz ?? 2
    const ry = targetSp?.ry ?? config.DEFAULT_ACTOR_ROTATION_Y

    this.position.set(px, py, pz)
    this.rotationY = ry
    this.rampPitchAngle = 0
    this.rampRollAngle = 0
    this.velocity.set(0, 0, 0)
    this.isOnGround = true
    this.group.position.copy(this.position)
    this.group.rotation.set(0, this.rotationY, 0)
  }

  public calculateRampIncline(
    dt: number,
    colliderBVH: any,
    forwardX: number,
    forwardZ: number,
    rightX: number,
    rightZ: number,
    options: RampSlopeConfig = {}
  ): { pitch: number; roll: number } {
    const aheadOffset = options.aheadOffset ?? 0.0
    const rayOriginHeight = options.rayOriginHeight ?? 1.5
    const maxRayDistance = options.maxRayDistance ?? 4.0
    const minNormalY = options.minNormalY ?? 0.3
    const clampThreshold = options.clampThreshold ?? 0.99
    const lerpSpeed = options.lerpSpeed ?? 12.0
    const airborneDecay = options.airborneDecay ?? 2.0
    const pitchMultiplier = options.pitchMultiplier ?? 1.0
    const rollMultiplier = options.rollMultiplier ?? 1.0

    let targetRampPitch = 0
    let targetRampRoll = 0

    if (this.isOnGround && colliderBVH) {
      const rayX = this.position.x + forwardX * aheadOffset
      const rayZ = this.position.z + forwardZ * aheadOffset
      _tempRay.origin.set(rayX, this.position.y + rayOriginHeight, rayZ)
      _tempRay.direction.set(0, -1, 0)
      const hit = colliderBVH.raycastFirst(_tempRay)

      if (hit && hit.distance < maxRayDistance && hit.face && hit.face.normal) {
        const groundNormal = hit.face.normal
        if (groundNormal.y > minNormalY) {
          const fwdDot = forwardX * groundNormal.x + forwardZ * groundNormal.z
          const rightDot = rightX * groundNormal.x + rightZ * groundNormal.z

          targetRampPitch = Math.asin(Math.max(-clampThreshold, Math.min(clampThreshold, fwdDot))) * pitchMultiplier
          targetRampRoll = -Math.asin(Math.max(-clampThreshold, Math.min(clampThreshold, rightDot))) * rollMultiplier
        }
      }
    } else if (!this.isOnGround) {
      targetRampPitch = this.rampPitchAngle * Math.max(0, 1.0 - airborneDecay * dt)
      targetRampRoll = this.rampRollAngle * Math.max(0, 1.0 - airborneDecay * dt)
    }

    this.rampPitchAngle += (targetRampPitch - this.rampPitchAngle) * Math.min(1.0, lerpSpeed * dt)
    this.rampRollAngle += (targetRampRoll - this.rampRollAngle) * Math.min(1.0, lerpSpeed * dt)

    return { pitch: this.rampPitchAngle, roll: this.rampRollAngle }
  }

  /**
   * Universal slope alignment using orthonormal basis matrix.
   * Eliminates gimbal lock, lag, and 180-degree flip bugs on ramps.
   */
  public updateSlopeOrientation(
    dt: number,
    colliderBVH: any,
    lerpSpeed: number = 15.0
  ): void {
    if (!this.isOnGround || !colliderBVH) {
      _tempEuler.set(0, this.rotationY, 0, 'YXZ')
      _tempTargetQuat.setFromEuler(_tempEuler)
      this.group.quaternion.slerp(_tempTargetQuat, Math.min(1.0, 8.0 * dt))
      return
    }

    _tempRay.origin.set(this.position.x, this.position.y + 1.5, this.position.z)
    _tempRay.direction.set(0, -1, 0)
    const hit = colliderBVH.raycastFirst(_tempRay)

    if (hit && hit.distance < 4.0 && hit.face && hit.face.normal) {
      const normal = hit.face.normal
      if (normal.y > 0.3) {
        const fwdX = Math.sin(this.rotationY)
        const fwdZ = Math.cos(this.rotationY)
        _tempFlatFwd.set(fwdX, 0, fwdZ)

        _tempUp.copy(normal).normalize()

        // Right vector on slope = Up Normal x Flat Forward
        _tempSlopeRight.crossVectors(_tempUp, _tempFlatFwd)
        if (_tempSlopeRight.lengthSq() < 1e-5) {
          _tempSlopeRight.set(Math.cos(this.rotationY), 0, -Math.sin(this.rotationY))
        } else {
          _tempSlopeRight.normalize()
        }

        // Forward on slope = Right x Up Normal
        _tempSlopeFwd.crossVectors(_tempSlopeRight, _tempUp).normalize()

        _tempBasisMat.makeBasis(_tempSlopeRight, _tempUp, _tempSlopeFwd)
        _tempTargetQuat.setFromRotationMatrix(_tempBasisMat)

        this.group.quaternion.slerp(_tempTargetQuat, Math.min(1.0, lerpSpeed * dt))
        return
      }
    }

    _tempEuler.set(0, this.rotationY, 0, 'YXZ')
    _tempTargetQuat.setFromEuler(_tempEuler)
    this.group.quaternion.slerp(_tempTargetQuat, Math.min(1.0, 8.0 * dt))
  }

  public jump(): void {
    if (this.isOnGround) {
      this.velocity.y = 11.0
      this.isOnGround = false
    }
  }

  public setDisplayCollider(visible: boolean): void {
    this.showCollider = visible
    if (this.colliderWireframe) {
      this.colliderWireframe.visible = visible
    }
  }

  abstract buildMesh(): void
  abstract updatePhysics(
    dt: number,
    keysPressed: Record<string, boolean>,
    speedMultiplier: number,
    colliderBVH: any,
    camera?: THREE.Camera
  ): void
  abstract getType(): 'human' | 'car' | 'quadruped'

  public getFPVOffset(): THREE.Vector3 {
    return new THREE.Vector3(0, 1.5, 0.1)
  }

  public isCrouching(): boolean {
    return false
  }

  public setMeshVisibleForFPV(isFPV: boolean): void {
    this.group.visible = !isFPV
  }

  public setPosition(x: number, y: number, z: number, ry: number): void {
    this.position.set(x, y, z)
    this.rotationY = ry
    this.group.position.copy(this.position)
    this.group.rotation.set(0, ry, 0)
  }

  public getCurrentAnimationName(): string {
    return 'Idle_A'
  }

  public getMotionState(t: number): MotionFrame {
    _tempEuler.setFromQuaternion(this.group.quaternion, 'YXZ')
    return {
      t: Math.round(t * 1000) / 1000,
      px: Math.round(this.group.position.x * 1000) / 1000,
      py: Math.round(this.group.position.y * 1000) / 1000,
      pz: Math.round(this.group.position.z * 1000) / 1000,
      rx: Math.round(_tempEuler.x * 1000) / 1000,
      ry: Math.round(this.rotationY * 1000) / 1000,
      rz: Math.round(_tempEuler.z * 1000) / 1000,
    }
  }

  public applyMotionFrame(frame: any, diffY: number = 0, dt: number = 0.016, isHardCut: boolean = false): void {
    if (!frame) return

    const prevX = this.position.x
    const prevZ = this.position.z

    this.position.set(frame.px ?? 0, frame.py ?? config.GROUND_Y, frame.pz ?? 0)
    this.rotationY = frame.ry ?? 0
    const rx = frame.rx ?? 0
    const rz = frame.rz ?? 0

    _tempEuler.set(rx, this.rotationY, rz, 'YXZ')
    this.group.quaternion.setFromEuler(_tempEuler)
    this.group.position.copy(this.position)

    const dx = this.position.x - prevX
    const dz = this.position.z - prevZ
    const distMoved = isHardCut ? 0 : Math.sqrt(dx * dx + dz * dz)

    this.onPlaybackMotion(distMoved, diffY, frame.anim, dt, isHardCut)
  }

  public onPlaybackMotion(_distMoved: number, _diffY: number, _animName?: string, _dt: number = 0.016, _isHardCut: boolean = false): void {}

  public resetAnimation(_initialAnim?: string): void {}

  /**
   * Universal ground raycasting & gravity resolution shared by all actors.
   * Uses exact vertical ray-triangle intersection to find floor height directly beneath (X, Z).
   */
  protected updateGroundAndGravity(dt: number, colliderBVH: any): void {
    let targetGroundY: number | null = null

    if (colliderBVH) {
      _tempRay.origin.set(this.position.x, this.position.y + 50.0, this.position.z)
      _tempRay.direction.set(0, -1, 0)

      let highestBelow: number | null = null
      let lowestAbove: number | null = null

      colliderBVH.shapecast({
        intersectsBounds: (box: THREE.Box3) => _tempRay.intersectsBox(box),
        intersectsTriangle: (tri: any) => {
          tri.getNormal(_tempNormal)
          if (_tempNormal.y > 0.3) {
            if (_tempRay.intersectTriangle(tri.a, tri.b, tri.c, false, _tempHitPoint)) {
              if (_tempHitPoint.y <= this.position.y + 1.2) {
                if (highestBelow === null || _tempHitPoint.y > highestBelow) {
                  highestBelow = _tempHitPoint.y
                }
              } else {
                if (lowestAbove === null || _tempHitPoint.y < lowestAbove) {
                  lowestAbove = _tempHitPoint.y
                }
              }
            }
          }
        }
      })

      if (highestBelow !== null) {
        targetGroundY = highestBelow
      } else if (lowestAbove !== null) {
        targetGroundY = lowestAbove
      }
    } else {
      if (Math.abs(this.position.x) <= 50.0 && Math.abs(this.position.z) <= 50.0) {
        targetGroundY = config.GROUND_Y
      }
    }

    if (targetGroundY !== null) {
      if (this.position.y <= targetGroundY + 0.1) {
        this.position.y = targetGroundY
        this.velocity.y = 0
        this.isOnGround = true
      } else {
        this.velocity.y -= 30.0 * dt
        this.position.y += this.velocity.y * dt
        if (this.position.y <= targetGroundY) {
          this.position.y = targetGroundY
          this.velocity.y = 0
          this.isOnGround = true
        } else {
          this.isOnGround = false
        }
      }
    } else {
      this.velocity.y -= 30.0 * dt
      this.position.y += this.velocity.y * dt
      this.isOnGround = false

      if (this.position.y < -10.0) {
        this.resetToOrigin()
      }
    }
  }

  public dispose(): void {
    this.group.traverse((child) => {
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
}
