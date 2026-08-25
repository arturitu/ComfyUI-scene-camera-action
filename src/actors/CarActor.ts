import * as THREE from 'three'
import { BaseActor } from './BaseActor'
import * as config from '../threeConfig'

import type { SpawnPoint } from '../types'

const SLOPE_CONFIG = {
  maxRayDistance: 3.0,
  minNormalY: 0.3,
  clampThreshold: 0.99,
  rayOriginHeight: 1.0,
  lerpSpeed: 10.0,
  airborneDecay: 1.0,
  pitchMultiplier: 1.0,
  rollMultiplier: 1.0,
}

// Module-level static scratch objects to eliminate Garbage Collection allocations per frame
const _tempVecA = new THREE.Vector3()
const _tempVecB = new THREE.Vector3()
const _tempDir = new THREE.Vector3()
const _tempFwd = new THREE.Vector3()
const _tempRight = new THREE.Vector3()
const _tempSegment = new THREE.Line3()
const _tempCapsuleBounds = new THREE.Box3()
const _tempRay = new THREE.Ray()
const _tempEuler = new THREE.Euler()

const LOCAL_PROBES = [
  { x: -0.85, z: 1.35 },  // Front-Left
  { x: 0.85, z: 1.35 },   // Front-Right
  { x: -0.85, z: -1.35 }, // Rear-Left
  { x: 0.85, z: -1.35 },  // Rear-Right
  { x: 0.0, z: 0.0 },     // Center
]

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
  private currentSpeed: number = 0
  private currentSteerAngle: number = 0

  private frontLeftWheelGroup: THREE.Group | null = null
  private frontRightWheelGroup: THREE.Group | null = null
  private rearLeftWheelGroup: THREE.Group | null = null
  private rearRightWheelGroup: THREE.Group | null = null
  private wheelRollingGroup: THREE.Group[] = []

  private bodySuspensionGroup: THREE.Group | null = null
  private pitchAngle: number = 0
  private rollAngle: number = 0
  private prevSpeed: number = 0
  private prevPlaybackSpeed: number = 0

  constructor() {
    super()
    this.buildMesh()
  }

  public getType(): 'car' {
    return 'car'
  }

  public override getFPVOffset(): THREE.Vector3 {
    return new THREE.Vector3(-0.45, 1.15, 0.15)
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
      const rollDelta = distMoved / 0.38
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

    // Elevate carGroup so tires rest 100% flush on top of floor Y = 0
    carGroup.position.y = 0.22
    this.group.add(carGroup)

    // 5. Car Collider Wireframe Visualizer
    const colliderGeo = new THREE.BoxGeometry(2.00, 1.20, 4.30)
    const colliderMat = new THREE.MeshBasicMaterial({
      color: 0x00ffff,
      wireframe: true,
      depthTest: false,
      depthWrite: false,
      transparent: true,
      opacity: 0.85,
    })
    this.colliderWireframe = new THREE.Mesh(colliderGeo, colliderMat)
    this.colliderWireframe.position.set(0, 0.85, 0)
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

    const maxForwardSpeed = speedMultiplier * 1.5
    const maxReverseSpeed = speedMultiplier * 0.6

    const accel = 18.0 * dt
    const brake = 30.0 * dt
    const drag = 8.0 * dt

    // 1. Movement input logic
    if (isW) {
      if (this.currentSpeed < maxForwardSpeed) {
        this.currentSpeed = Math.min(maxForwardSpeed, this.currentSpeed + accel)
      }
    } else if (isS) {
      if (this.currentSpeed > 0) {
        this.currentSpeed = Math.max(0, this.currentSpeed - brake)
      } else if (this.currentSpeed > -maxReverseSpeed) {
        this.currentSpeed = Math.max(-maxReverseSpeed, this.currentSpeed - accel)
      }
    } else {
      if (this.currentSpeed > 0) {
        this.currentSpeed = Math.max(0, this.currentSpeed - drag)
      } else if (this.currentSpeed < 0) {
        this.currentSpeed = Math.min(0, this.currentSpeed + drag)
      }
    }

    // 2. Steering logic
    let steerInput = 0
    if (isA) steerInput += 1
    if (isD) steerInput -= 1

    if (steerInput !== 0 && Math.abs(this.currentSpeed) > 0.05) {
      const turnDir = this.currentSpeed < 0 ? -1 : 1
      const turnFactor = Math.min(1.0, Math.abs(this.currentSpeed) / 3.0)
      this.rotationY += steerInput * turnDir * 2.2 * turnFactor * dt
    }

    let targetSteer = 0
    if (isA) targetSteer += 0.45
    if (isD) targetSteer -= 0.45

    this.currentSteerAngle += (targetSteer - this.currentSteerAngle) * Math.min(1.0, 15.0 * dt)
    if (this.frontLeftWheelGroup) this.frontLeftWheelGroup.rotation.y = this.currentSteerAngle
    if (this.frontRightWheelGroup) this.frontRightWheelGroup.rotation.y = this.currentSteerAngle

    if (Math.abs(this.currentSpeed) > 0.01) {
      const rollDelta = (this.currentSpeed * dt) / 0.2
      this.wheelRollingGroup.forEach((w) => {
        w.rotation.x += rollDelta
      })
    }

    // 3. Suspension Pitch & Roll
    const speedDelta = (this.currentSpeed - this.prevSpeed) / Math.max(0.001, dt)
    this.prevSpeed = this.currentSpeed

    const speedRatio = Math.min(1.0, Math.abs(this.currentSpeed) / Math.max(0.1, maxForwardSpeed))
    const normalizedTurn = Math.max(-1.0, Math.min(1.0, (this.currentSteerAngle / 0.45) * speedRatio))

    let targetPitch = 0
    if (this.currentSpeed > 0.05) {
      targetPitch = -0.052 * speedRatio
    } else if (this.currentSpeed < -0.05) {
      targetPitch = 0.035 * speedRatio
    }

    targetPitch += Math.max(-0.04, Math.min(0.04, speedDelta * -0.003))
    const targetRoll = -0.09 * normalizedTurn

    this.pitchAngle += (targetPitch - this.pitchAngle) * Math.min(1.0, 10.0 * dt)
    this.rollAngle += (targetRoll - this.rollAngle) * Math.min(1.0, 10.0 * dt)

    if (this.bodySuspensionGroup) {
      this.bodySuspensionGroup.rotation.x = this.pitchAngle
      this.bodySuspensionGroup.rotation.z = this.rollAngle
    }

    // 4. Movement integration & Collision shapecast
    this.velocity.x = Math.sin(this.rotationY) * this.currentSpeed
    this.velocity.z = Math.cos(this.rotationY) * this.currentSpeed

    const physicsSteps = 5
    const stepDt = dt / physicsSteps
    let touchGround = false

    const forwardX = Math.sin(this.rotationY)
    const forwardZ = Math.cos(this.rotationY)
    const rightX = Math.cos(this.rotationY)
    const rightZ = -Math.sin(this.rotationY)

    for (let step = 0; step < physicsSteps; step++) {
      this.velocity.y -= 30 * stepDt
      this.position.addScaledVector(this.velocity, stepDt)

      if (colliderBVH) {
        const radius = 0.38
        const height = 0.20

        _tempSegment.start.set(this.position.x, this.position.y + radius, this.position.z)
        _tempSegment.end.set(this.position.x, this.position.y + radius + height, this.position.z)

        _tempCapsuleBounds.min.set(this.position.x - 2.0, this.position.y - 0.5, this.position.z - 2.0)
        _tempCapsuleBounds.max.set(this.position.x + 2.0, this.position.y + radius + height + 1.5, this.position.z + 2.0)

        colliderBVH.shapecast({
          intersectsBounds: (box: THREE.Box3) => box.intersectsBox(_tempCapsuleBounds),
          intersectsTriangle: (tri: any) => {
            const distSq = tri.closestPointToSegment(_tempSegment, _tempVecA, _tempVecB)
            const dist = Math.sqrt(distSq)

            if (dist < radius) {
              const depth = radius - dist
              _tempDir.subVectors(_tempVecB, _tempVecA).normalize()
              if (_tempDir.y > 0.3) {
                touchGround = true
              }
              this.position.addScaledVector(_tempDir, depth)
              if (Math.abs(_tempDir.y) < 0.5) {
                this.currentSpeed *= 0.8
              }
            }
          }
        })

        if (touchGround && this.velocity.y <= 0) {
          this.velocity.y = 0
          this.isOnGround = true
        }
      } else {
        if (this.position.y <= config.GROUND_Y) {
          this.position.y = config.GROUND_Y
          this.velocity.y = 0
          this.isOnGround = true
          touchGround = true
        }
      }
    }

    if (!touchGround && colliderBVH) {
      this.isOnGround = false
    }

    this.group.position.copy(this.position)

    // 5. Universal Ramp Slope Orientation via Orthonormal Basis
    this.updateSlopeOrientation(dt, colliderBVH, 15.0)

    if (this.position.y < -10.0) {
      this.resetToOrigin()
    }
  }
}
