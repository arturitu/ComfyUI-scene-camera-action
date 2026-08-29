import * as THREE from 'three'
import { BaseActor } from './BaseActor'
import * as config from '../threeConfig'

import type { SpawnPoint } from '../types'

// Module-level static scratch objects to eliminate Garbage Collection allocations per frame
const _tempVecA = new THREE.Vector3()
const _tempVecB = new THREE.Vector3()
const _tempDir = new THREE.Vector3()
const _tempSegment = new THREE.Line3()
const _tempCapsuleBounds = new THREE.Box3()
const _tempEuler = new THREE.Euler()

export class CarActor extends BaseActor {
  public override actorColor: string = '#0284C7'
  private bodyMat: THREE.MeshStandardMaterial | null = null

  public override setActorColor(hexColor: string): void {
    if (!hexColor) return
    this.actorColor = hexColor
    if (this.bodyMat) {
      this.bodyMat.color.set(hexColor)
    }
  }

  protected override getSlopeProbes(): { frontZ: number; rearZ: number; halfWidth: number } {
    return {
      frontZ: 1.35 * this.scale,
      rearZ: 1.35 * this.scale,
      halfWidth: 0.85 * this.scale
    }
  }

  private currentSpeed: number = 0
  private currentSteerAngle: number = 0

  private frontLeftWheelGroup: THREE.Group | null = null
  private frontRightWheelGroup: THREE.Group | null = null
  private rearLeftWheelGroup: THREE.Group | null = null
  private rearRightWheelGroup: THREE.Group | null = null
  private wheelRollingGroup: THREE.Group[] = []

  private pitchAngle: number = 0
  private rollAngle: number = 0
  private prevSpeed: number = 0
  private prevPlaybackSpeed: number = 0
  private bodySuspensionGroup: THREE.Group | null = null

  constructor() {
    super()
    this.buildMesh()
  }

  public getType(): 'human' | 'car' | 'quadruped' {
    return 'car'
  }

  public override getFPVOffset(): THREE.Vector3 {
    return new THREE.Vector3(-0.45 * this.scale, 1.15 * this.scale, 0.15 * this.scale)
  }

  public override onPlaybackMotion(distMoved: number, angularVel: number, _animName?: string, frameDt: number = 0.016): void {
    const dt = Math.max(0.001, frameDt)
    const currentSpeed = distMoved / dt
    const speedDelta = (currentSpeed - this.prevPlaybackSpeed) / dt
    this.prevPlaybackSpeed = currentSpeed

    const targetSteer = Math.max(-0.38, Math.min(0.38, angularVel * 0.35))
    this.currentSteerAngle += (targetSteer - this.currentSteerAngle) * 0.3
    if (this.frontLeftWheelGroup) this.frontLeftWheelGroup.rotation.y = this.currentSteerAngle
    if (this.frontRightWheelGroup) this.frontRightWheelGroup.rotation.y = this.currentSteerAngle

    if (distMoved > 0.001) {
      const rollDelta = distMoved / (0.38 * this.scale)
      this.wheelRollingGroup.forEach((w) => {
        w.rotation.x += rollDelta
      })
    }

    const normalizedSpeed = Math.min(1.0, Math.abs(currentSpeed) / 6.0)
    const lateralRatio = Math.max(-1.0, Math.min(1.0, angularVel * 0.5 * normalizedSpeed))

    let targetPitch = 0
    if (currentSpeed > 0.05) {
      targetPitch = -0.052 * normalizedSpeed
    } else if (currentSpeed < -0.05) {
      targetPitch = 0.035 * normalizedSpeed
    }

    targetPitch += Math.max(-0.04, Math.min(0.04, speedDelta * -0.003))
    const targetRoll = -0.09 * lateralRatio

    this.pitchAngle += (targetPitch - this.pitchAngle) * 0.15
    this.rollAngle += (targetRoll - this.rollAngle) * 0.15

    if (this.bodySuspensionGroup) {
      this.bodySuspensionGroup.rotation.x = this.pitchAngle
      this.bodySuspensionGroup.rotation.z = this.rollAngle
    }
  }

  public override resetToOrigin(sp?: SpawnPoint): void {
    super.resetToOrigin(sp)
    this.currentSpeed = 0
    this.prevSpeed = 0
    this.prevPlaybackSpeed = 0
    this.currentSteerAngle = 0
    this.pitchAngle = 0
    this.rollAngle = 0
    this.rampPitchAngle = 0
    this.rampRollAngle = 0
    if (this.bodySuspensionGroup) {
      this.bodySuspensionGroup.rotation.set(0, 0, 0)
    }
  }

  public buildMesh(): void {
    while (this.group.children.length > 0) {
      this.group.remove(this.group.children[0])
    }

    const carGroup = new THREE.Group()
    this.bodySuspensionGroup = new THREE.Group()

    // Shared material for main car body & cabin
    this.bodyMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(this.actorColor),
      roughness: 0.4,
      metalness: 0.1,
    })
    const bodyMat = this.bodyMat

    // 1. Car Body (1.90m W x 0.65m H x 4.20m L)
    const bodyGeo = new THREE.BoxGeometry(1.90, 0.65, 4.20)
    const bodyMesh = new THREE.Mesh(bodyGeo, bodyMat)
    bodyMesh.position.y = 0.65
    bodyMesh.castShadow = true
    bodyMesh.receiveShadow = true
    this.bodySuspensionGroup.add(bodyMesh)

    // 2. Car Cabin
    const cabinShape = new THREE.Shape()
    cabinShape.moveTo(-1.00, 0.0)
    cabinShape.lineTo(-0.25, 0.65)
    cabinShape.lineTo(0.70, 0.65)
    cabinShape.lineTo(1.00, 0.0)
    cabinShape.closePath()

    const cabinGeo = new THREE.ExtrudeGeometry(cabinShape, { depth: 1.60, bevelEnabled: false })
    cabinGeo.rotateY(Math.PI / 2)
    cabinGeo.translate(-0.80, 0.98, -0.10)

    const cabinMesh = new THREE.Mesh(cabinGeo, bodyMat)
    cabinMesh.castShadow = true
    cabinMesh.receiveShadow = true
    this.bodySuspensionGroup.add(cabinMesh)

    // 3. Headlights & Brake Lights & Mirrors
    const headlightGeo = new THREE.BoxGeometry(0.35, 0.18, 0.08)
    const headlightMat = new THREE.MeshStandardMaterial({
      color: 0xfff066,
      emissive: 0xfff066,
      emissiveIntensity: 0.8,
    })
    const lightLeft = new THREE.Mesh(headlightGeo, headlightMat)
    lightLeft.position.set(-0.65, 0.65, 2.11)
    const lightRight = new THREE.Mesh(headlightGeo, headlightMat)
    lightRight.position.set(0.65, 0.65, 2.11)
    this.bodySuspensionGroup.add(lightLeft, lightRight)

    const brakelightGeo = new THREE.BoxGeometry(0.24, 0.18, 0.05)
    const brakelightMat = new THREE.MeshStandardMaterial({
      color: 0xdc2626,
      emissive: 0xdc2626,
      emissiveIntensity: 0.2,
    })
    const brakeLeft = new THREE.Mesh(brakelightGeo, brakelightMat)
    brakeLeft.position.set(-0.65, 0.65, -2.11)
    const brakeRight = new THREE.Mesh(brakelightGeo, brakelightMat)
    brakeRight.position.set(0.65, 0.65, -2.11)
    this.bodySuspensionGroup.add(brakeLeft, brakeRight)

    const mirrorGeo = new THREE.BoxGeometry(0.24, 0.14, 0.08)
    const mirrorMat = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.4, metalness: 0.1 })
    const mirrorLeft = new THREE.Mesh(mirrorGeo, mirrorMat)
    mirrorLeft.position.set(-1.02, 1.15, 0.40)
    mirrorLeft.castShadow = true
    const mirrorRight = new THREE.Mesh(mirrorGeo, mirrorMat)
    mirrorRight.position.set(1.02, 1.15, 0.40)
    mirrorRight.castShadow = true
    this.bodySuspensionGroup.add(mirrorLeft, mirrorRight)

    carGroup.add(this.bodySuspensionGroup)

    // 4. Wheels (0.38m radius = 0.76m diameter)
    const tireShape = new THREE.Shape()
    tireShape.absarc(0, 0, 0.38, 0, Math.PI * 2, false)
    const tireHole = new THREE.Path()
    tireHole.absarc(0, 0, 0.18, 0, Math.PI * 2, true)
    tireShape.holes.push(tireHole)

    const tireGeo = new THREE.ExtrudeGeometry(tireShape, { depth: 0.26, bevelEnabled: false, curveSegments: 16 })
    tireGeo.center()
    const tireMat = new THREE.MeshStandardMaterial({ color: 0x18181b, roughness: 0.6, metalness: 0.1 })

    const hubGeo = new THREE.CylinderGeometry(0.18, 0.18, 0.26, 16)
    const hubMat = new THREE.MeshStandardMaterial({ color: 0xf1f5f9, roughness: 0.4, metalness: 0.1 })

    this.wheelRollingGroup = []

    const createWheelAssembly = () => {
      const pivotGroup = new THREE.Group()
      const rollingGroup = new THREE.Group()

      const tireMesh = new THREE.Mesh(tireGeo, tireMat)
      tireMesh.rotation.y = Math.PI / 2
      tireMesh.castShadow = true
      rollingGroup.add(tireMesh)

      const hubMesh = new THREE.Mesh(hubGeo, hubMat)
      hubMesh.rotation.z = Math.PI / 2
      hubMesh.castShadow = true
      rollingGroup.add(hubMesh)

      pivotGroup.add(rollingGroup)
      this.wheelRollingGroup.push(rollingGroup)
      return pivotGroup
    }

    this.frontLeftWheelGroup = createWheelAssembly()
    this.frontLeftWheelGroup.position.set(-0.95, 0.38, 1.30)
    this.frontRightWheelGroup = createWheelAssembly()
    this.frontRightWheelGroup.position.set(0.95, 0.38, 1.30)
    this.rearLeftWheelGroup = createWheelAssembly()
    this.rearLeftWheelGroup.position.set(-0.95, 0.38, -1.30)
    this.rearRightWheelGroup = createWheelAssembly()
    this.rearRightWheelGroup.position.set(0.95, 0.38, -1.30)

    carGroup.add(
      this.frontLeftWheelGroup,
      this.frontRightWheelGroup,
      this.rearLeftWheelGroup,
      this.rearRightWheelGroup
    )

    // CarGroup rests with tire bottoms flush on floor Y = 0
    carGroup.position.y = 0.0
    this.group.add(carGroup)

    // 5. Car Collider Wireframe Visualizer
    const colliderGeo = new THREE.BoxGeometry(1.90, 1.30, 4.20)
    const colliderMat = new THREE.MeshBasicMaterial({
      color: 0x00ffff,
      wireframe: true,
      depthTest: false,
      depthWrite: false,
      transparent: true,
      opacity: 0.85,
    })
    this.colliderWireframe = new THREE.Mesh(colliderGeo, colliderMat)
    this.colliderWireframe.position.set(0, 0.65, 0)
    this.colliderWireframe.renderOrder = 1000
    this.colliderWireframe.visible = this.showCollider
    this.group.add(this.colliderWireframe)
  }

  public updatePhysics(
    dt: number,
    keysPressed: Record<string, boolean>,
    speedMultiplier: number,
    colliderBVH: any,
    _camera?: THREE.Camera
  ): void {
    const isW = keysPressed['ArrowUp'] || keysPressed['KeyW']
    const isS = keysPressed['ArrowDown'] || keysPressed['KeyS']
    const isA = keysPressed['ArrowLeft'] || keysPressed['KeyA']
    const isD = keysPressed['ArrowRight'] || keysPressed['KeyD']
    const isSpace = keysPressed['Space'] || keysPressed[' ']

    if (isSpace && this.isOnGround) {
      this.jump()
    }

    const maxForwardSpeed = speedMultiplier * 1.0
    const maxReverseSpeed = speedMultiplier * 0.45

    const accel = 12.0 * dt
    const brake = 25.0 * dt
    const drag = 6.0 * dt

    // Slope gravity resistance
    let slopeForce = 0
    if (this.isOnGround && Math.abs(this.rampPitchAngle) > 0.02) {
      // When rampPitchAngle < 0 (pitched up going uphill), sin is negative, pulling speed back
      slopeForce = 15.0 * Math.sin(this.rampPitchAngle) * dt
    }

    // 1. Movement input logic
    if (isW) {
      if (this.currentSpeed < maxForwardSpeed) {
        this.currentSpeed = Math.min(maxForwardSpeed, this.currentSpeed + accel + slopeForce)
      } else {
        this.currentSpeed += slopeForce
      }
    } else if (isS) {
      if (this.currentSpeed > 0) {
        this.currentSpeed = Math.max(0, this.currentSpeed - brake + slopeForce)
      } else if (this.currentSpeed > -maxReverseSpeed) {
        this.currentSpeed = Math.max(-maxReverseSpeed, this.currentSpeed - accel + slopeForce)
      } else {
        this.currentSpeed += slopeForce
      }
    } else {
      if (this.currentSpeed > 0) {
        this.currentSpeed = Math.max(0, this.currentSpeed - drag + slopeForce)
      } else if (this.currentSpeed < 0) {
        this.currentSpeed = Math.min(0, this.currentSpeed + drag + slopeForce)
      } else if (Math.abs(slopeForce) > 0.05) {
        // Roll down slopes when in neutral
        this.currentSpeed += slopeForce
      }
    }

    // 2. Steering logic
    let steerInput = 0
    if (isA) steerInput += 1
    if (isD) steerInput -= 1

    if (steerInput !== 0 && Math.abs(this.currentSpeed) > 0.05) {
      const turnDir = this.currentSpeed < 0 ? -1 : 1
      const turnFactor = Math.min(1.0, Math.abs(this.currentSpeed) / 3.0)
      this.rotationY += steerInput * turnDir * (2.2 / Math.max(0.2, this.scale)) * turnFactor * dt
    }

    let targetSteer = 0
    if (isA) targetSteer += 0.45
    if (isD) targetSteer -= 0.45

    this.currentSteerAngle += (targetSteer - this.currentSteerAngle) * Math.min(1.0, 15.0 * dt)
    if (this.frontLeftWheelGroup) this.frontLeftWheelGroup.rotation.y = this.currentSteerAngle
    if (this.frontRightWheelGroup) this.frontRightWheelGroup.rotation.y = this.currentSteerAngle

    if (Math.abs(this.currentSpeed) > 0.01) {
      const rollDelta = (this.currentSpeed * dt) / (0.2 * this.scale)
      this.wheelRollingGroup.forEach((w) => {
        w.rotation.x += rollDelta
      })
    }

    // 3. Suspension Pitch & Roll
    const speedDelta = (this.currentSpeed - this.prevSpeed) / Math.max(0.001, dt)
    this.prevSpeed = this.currentSpeed

    const speedRatio = Math.min(1.0, Math.abs(this.currentSpeed) / Math.max(0.1, maxForwardSpeed))
    const normalizedTurn = Math.max(-1.0, Math.min(1.0, (this.currentSteerAngle / 0.45) * speedRatio))

    let targetSuspensionPitch = 0
    if (this.currentSpeed > 0.05) {
      targetSuspensionPitch = -0.052 * speedRatio
    } else if (this.currentSpeed < -0.05) {
      targetSuspensionPitch = 0.035 * speedRatio
    }

    targetSuspensionPitch += Math.max(-0.04, Math.min(0.04, speedDelta * -0.003))
    const targetRoll = -0.09 * normalizedTurn

    this.pitchAngle += (targetSuspensionPitch - this.pitchAngle) * Math.min(1.0, 10.0 * dt)
    this.rollAngle += (targetRoll - this.rollAngle) * Math.min(1.0, 10.0 * dt)

    if (this.bodySuspensionGroup) {
      this.bodySuspensionGroup.rotation.x = this.pitchAngle
      this.bodySuspensionGroup.rotation.z = this.rollAngle
    }

    const forwardX = Math.sin(this.rotationY)
    const forwardZ = Math.cos(this.rotationY)
    const slopeCos = Math.cos(this.rampPitchAngle)
    this.velocity.x = forwardX * this.currentSpeed * slopeCos
    this.velocity.z = forwardZ * this.currentSpeed * slopeCos

    // 1. Movement integration & Wall collision shapecast (Single central capsule)
    const physicsSteps = 5
    const stepDt = dt / physicsSteps
    const activeR = 0.85 * this.scale
    const activeH = 0.50 * this.scale

    for (let step = 0; step < physicsSteps; step++) {
      if (!this.isOnGround) {
        this.velocity.y -= 30.0 * stepDt
      }
      this.position.x += this.velocity.x * stepDt
      this.position.z += this.velocity.z * stepDt
      this.position.y += this.velocity.y * stepDt

      if (colliderBVH) {
        const stepUpOffset = this.isOnGround ? Math.min(0.30 * this.scale, activeH * 0.8) : 0
        _tempSegment.start.set(this.position.x, this.position.y + activeR + stepUpOffset, this.position.z)
        _tempSegment.end.set(this.position.x, this.position.y + activeR + activeH, this.position.z)

        const startSegmentX = _tempSegment.start.x
        const startSegmentZ = _tempSegment.start.z

        const boundMargin = Math.max(2.5, 2.5 * this.scale)
        _tempCapsuleBounds.min.set(this.position.x - boundMargin, this.position.y - 0.5, this.position.z - boundMargin)
        _tempCapsuleBounds.max.set(this.position.x + boundMargin, this.position.y + activeH + activeR + boundMargin, this.position.z + boundMargin)

        colliderBVH.shapecast({
          intersectsBounds: (box: THREE.Box3) => box.intersectsBox(_tempCapsuleBounds),
          intersectsTriangle: (tri: any) => {
            const dist = tri.closestPointToSegment(_tempSegment, _tempVecA, _tempVecB)
            if (dist < activeR) {
              const depth = activeR - dist
              _tempDir.subVectors(_tempVecB, _tempVecA)
              if (_tempDir.lengthSq() < 1e-6) {
                tri.getNormal(_tempDir)
              }
              _tempDir.normalize()

              // Only resolve horizontal wall collisions (walls have normal.y < 0.55)
              if (_tempDir.y < 0.55) {
                _tempDir.y = 0
                if (_tempDir.lengthSq() > 1e-6) {
                  _tempDir.normalize()
                  const pushDist = Math.min(depth, activeR)
                  _tempSegment.start.addScaledVector(_tempDir, pushDist)
                  _tempSegment.end.addScaledVector(_tempDir, pushDist)
                }
              }
            }
          }
        })

        // Apply net horizontal displacement from capsule resolution
        const deltaX = _tempSegment.start.x - startSegmentX
        const deltaZ = _tempSegment.start.z - startSegmentZ
        this.position.x += deltaX
        this.position.z += deltaZ

        // Wall sliding: project velocity onto wall tangent plane once per sub-step
        const pushDist = Math.sqrt(deltaX * deltaX + deltaZ * deltaZ)
        if (pushDist > 1e-5) {
          const normX = deltaX / pushDist
          const normZ = deltaZ / pushDist
          const dot = this.velocity.x * normX + this.velocity.z * normZ
          if (dot < 0) {
            this.velocity.x -= normX * dot
            this.velocity.z -= normZ * dot
            this.currentSpeed = Math.sign(this.currentSpeed || 1) * Math.sqrt(this.velocity.x * this.velocity.x + this.velocity.z * this.velocity.z)
          }
        }
      }
    }

    // 2. Exact Dual-Axle Ground Sampling for ground & ramps
    const halfWheelbase = 1.30 * this.scale
    const wheelbase = 2.60 * this.scale
    const frontX = this.position.x + forwardX * halfWheelbase
    const frontZ = this.position.z + forwardZ * halfWheelbase
    const rearX = this.position.x - forwardX * halfWheelbase
    const rearZ = this.position.z - forwardZ * halfWheelbase

    const frontG = this.sampleGround(frontX, frontZ, colliderBVH, this.position.y)
    const rearG = this.sampleGround(rearX, rearZ, colliderBVH, this.position.y)

    let groundFound = false
    let targetGroundY = config.GROUND_Y
    let targetPitch = 0

    if (frontG.hit && rearG.hit && Math.abs(frontG.y - rearG.y) < wheelbase * 1.15) {
      groundFound = true
      targetGroundY = (frontG.y + rearG.y) / 2.0
      const rawPitch = -Math.atan2(frontG.y - rearG.y, wheelbase)
      targetPitch = Math.max(-0.85, Math.min(0.85, rawPitch))
    } else if (frontG.hit || rearG.hit) {
      groundFound = true
      const bestG = (frontG.hit && (!rearG.hit || Math.abs(frontG.y - this.position.y) <= Math.abs(rearG.y - this.position.y))) ? frontG : rearG
      targetGroundY = bestG.y
      if (bestG.normal.y >= 0.55 && bestG.normal.y < 0.995) {
        const dot = forwardX * bestG.normal.x + forwardZ * bestG.normal.z
        targetPitch = Math.max(-0.85, Math.min(0.85, Math.asin(dot)))
      } else {
        targetPitch = 0
      }
    }

    // 3. Ground Snap vs Airborne vs Step-Up / Step-Down
    if (groundFound) {
      if (!this.isOnGround) {
        // Airborne: fall until wheels touch ground
        if (this.position.y <= targetGroundY && this.velocity.y <= 0) {
          this.position.y = targetGroundY
          this.velocity.y = 0
          this.isOnGround = true
        } else {
          this.isOnGround = false
        }
      } else {
        // Grounded vehicle: smooth suspension/curb adjustment
        const diffY = targetGroundY - this.position.y
        const maxStepUp = 0.35 * this.scale
        const maxStepDown = 0.60 * this.scale

        if (diffY > 0) {
          if (diffY <= maxStepUp) {
            const smoothFactor = 1.0 - Math.exp(-22.0 * dt)
            this.position.y += diffY * smoothFactor
            this.velocity.y = 0
            this.isOnGround = true
          } else {
            this.velocity.y = 0
            this.isOnGround = true
          }
        } else {
          const drop = -diffY
          if (drop <= maxStepDown) {
            const smoothFactor = 1.0 - Math.exp(-22.0 * dt)
            this.position.y += diffY * smoothFactor
            this.velocity.y = 0
            this.isOnGround = true
          } else {
            this.isOnGround = false
          }
        }
      }
    } else {
      this.isOnGround = false
    }

    if (this.position.y < -10.0) {
      this.resetToOrigin()
      return
    }

    this.rampPitchAngle += (targetPitch - this.rampPitchAngle) * Math.min(1.0, 15.0 * dt)

    this.group.position.copy(this.position)
    _tempEuler.set(this.rampPitchAngle, this.rotationY, 0, 'YXZ')
    this.group.quaternion.setFromEuler(_tempEuler)
  }
}
