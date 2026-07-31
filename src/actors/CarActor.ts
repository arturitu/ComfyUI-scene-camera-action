import * as THREE from 'three'
import { BaseActor } from './BaseActor'
import * as config from '../threeConfig'

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
const _tempFwd = new THREE.Vector3()
const _tempRight = new THREE.Vector3()
const _tempSegment = new THREE.Line3()
const _tempCapsuleBounds = new THREE.Box3()
const _tempRay = new THREE.Ray()
const _tempEuler = new THREE.Euler()

const LOCAL_PROBES = [
  { x: -0.38, z: 0.72 },  // Front-Left
  { x: 0.38, z: 0.72 },   // Front-Right
  { x: -0.38, z: -0.72 }, // Rear-Left
  { x: 0.38, z: -0.72 },  // Rear-Right
  { x: 0.0, z: 0.0 },     // Center
]

export class CarActor extends BaseActor {
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
  private rampPitchAngle: number = 0
  private rampRollAngle: number = 0
  private prevSpeed: number = 0
  private prevPlaybackSpeed: number = 0

  constructor() {
    super()
    this.rotationY = config.DEFAULT_ACTOR_ROTATION_Y
    this.group.rotation.y = this.rotationY
    this.buildMesh()
  }

  public getType(): 'car' {
    return 'car'
  }

  public override getFPVOffset(): THREE.Vector3 {
    return new THREE.Vector3(-0.25, 0.95, -0.1)
  }

  public override onPlaybackMotion(distMoved: number, angularVel: number): void {
    const dt = 1 / 60
    const currentSpeed = distMoved / dt
    const speedDelta = (currentSpeed - this.prevPlaybackSpeed) / dt
    this.prevPlaybackSpeed = currentSpeed

    const targetSteer = Math.max(-0.45, Math.min(0.45, angularVel * 0.35))
    this.currentSteerAngle += (targetSteer - this.currentSteerAngle) * 0.3
    if (this.frontLeftWheelGroup) this.frontLeftWheelGroup.rotation.y = this.currentSteerAngle
    if (this.frontRightWheelGroup) this.frontRightWheelGroup.rotation.y = this.currentSteerAngle

    if (distMoved > 0.001) {
      const rollDelta = distMoved / 0.20
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

  public override resetToOrigin(): void {
    this.position.set(0, config.GROUND_Y, 2)
    this.rotationY = config.DEFAULT_ACTOR_ROTATION_Y
    this.group.rotation.y = this.rotationY
    this.velocity.set(0, 0, 0)
    this.currentSpeed = 0
    this.prevSpeed = 0
    this.prevPlaybackSpeed = 0
    this.currentSteerAngle = 0
    this.pitchAngle = 0
    this.rollAngle = 0
    this.rampPitchAngle = 0
    this.rampRollAngle = 0
    if (this.bodySuspensionGroup) {
      this.bodySuspensionGroup.rotation.x = 0
      this.bodySuspensionGroup.rotation.z = 0
    }
    this.isOnGround = true
    this.group.position.copy(this.position)
    this.group.rotation.set(0, 0, 0)
  }

  public buildMesh(): void {
    while (this.group.children.length > 0) {
      this.group.remove(this.group.children[0])
    }

    const carGroup = new THREE.Group()
    this.bodySuspensionGroup = new THREE.Group()

    // Shared material for main car body & cabin
    const bodyMat = new THREE.MeshStandardMaterial({
      color: 0x0284c7,
      roughness: 0.4,
      metalness: 0.1,
    })

    // 1. Car Body
    const bodyGeo = new THREE.BoxGeometry(1.0, 0.4, 1.8)
    const bodyMesh = new THREE.Mesh(bodyGeo, bodyMat)
    bodyMesh.position.y = 0.35
    bodyMesh.castShadow = true
    bodyMesh.receiveShadow = true
    this.bodySuspensionGroup.add(bodyMesh)

    // 2. Car Cabin
    const cabinShape = new THREE.Shape()
    cabinShape.moveTo(-0.45, 0.0)
    cabinShape.lineTo(-0.12, 0.28)
    cabinShape.lineTo(0.35, 0.28)
    cabinShape.lineTo(0.45, 0.0)
    cabinShape.closePath()

    const cabinGeo = new THREE.ExtrudeGeometry(cabinShape, { depth: 0.80, bevelEnabled: false })
    cabinGeo.rotateY(Math.PI / 2)
    cabinGeo.translate(-0.40, 0.55, -0.05)

    const cabinMesh = new THREE.Mesh(cabinGeo, bodyMat)
    cabinMesh.castShadow = true
    cabinMesh.receiveShadow = true
    this.bodySuspensionGroup.add(cabinMesh)

    // 3. Headlights & Brake Lights & Mirrors
    const headlightGeo = new THREE.BoxGeometry(0.2, 0.1, 0.05)
    const headlightMat = new THREE.MeshStandardMaterial({
      color: 0xfff066,
      emissive: 0xfff066,
      emissiveIntensity: 0.8,
    })
    const lightLeft = new THREE.Mesh(headlightGeo, headlightMat)
    lightLeft.position.set(-0.35, 0.35, 0.91)
    const lightRight = new THREE.Mesh(headlightGeo, headlightMat)
    lightRight.position.set(0.35, 0.35, 0.91)
    this.bodySuspensionGroup.add(lightLeft, lightRight)

    const brakelightGeo = new THREE.BoxGeometry(0.12, 0.10, 0.03)
    const brakelightMat = new THREE.MeshStandardMaterial({
      color: 0xdc2626,
      emissive: 0xdc2626,
      emissiveIntensity: 0.2,
    })
    const brakeLeft = new THREE.Mesh(brakelightGeo, brakelightMat)
    brakeLeft.position.set(-0.35, 0.35, -0.91)
    const brakeRight = new THREE.Mesh(brakelightGeo, brakelightMat)
    brakeRight.position.set(0.35, 0.35, -0.91)
    this.bodySuspensionGroup.add(brakeLeft, brakeRight)

    const mirrorGeo = new THREE.BoxGeometry(0.14, 0.08, 0.05)
    const mirrorMat = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.4, metalness: 0.1 })
    const mirrorLeft = new THREE.Mesh(mirrorGeo, mirrorMat)
    mirrorLeft.position.set(-0.47, 0.65, 0.20)
    mirrorLeft.castShadow = true
    const mirrorRight = new THREE.Mesh(mirrorGeo, mirrorMat)
    mirrorRight.position.set(0.47, 0.65, 0.20)
    mirrorRight.castShadow = true
    this.bodySuspensionGroup.add(mirrorLeft, mirrorRight)

    carGroup.add(this.bodySuspensionGroup)

    // 4. Wheels
    const tireShape = new THREE.Shape()
    tireShape.absarc(0, 0, 0.20, 0, Math.PI * 2, false)
    const tireHole = new THREE.Path()
    tireHole.absarc(0, 0, 0.09, 0, Math.PI * 2, true)
    tireShape.holes.push(tireHole)

    const tireGeo = new THREE.ExtrudeGeometry(tireShape, { depth: 0.18, bevelEnabled: false, curveSegments: 16 })
    tireGeo.center()
    const tireMat = new THREE.MeshStandardMaterial({ color: 0x18181b, roughness: 0.6, metalness: 0.1 })

    const hubGeo = new THREE.CylinderGeometry(0.09, 0.09, 0.18, 16)
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
    this.frontLeftWheelGroup.position.set(-0.52, 0.2, 0.55)
    this.frontRightWheelGroup = createWheelAssembly()
    this.frontRightWheelGroup.position.set(0.52, 0.2, 0.55)
    this.rearLeftWheelGroup = createWheelAssembly()
    this.rearLeftWheelGroup.position.set(-0.52, 0.2, -0.55)
    this.rearRightWheelGroup = createWheelAssembly()
    this.rearRightWheelGroup.position.set(0.52, 0.2, -0.55)

    carGroup.add(
      this.frontLeftWheelGroup,
      this.frontRightWheelGroup,
      this.rearLeftWheelGroup,
      this.rearRightWheelGroup
    )

    carGroup.position.y = 0.22
    this.group.add(carGroup)

    // 5. Car Collider Wireframe Visualizer
    const colliderGeo = new THREE.BoxGeometry(1.30, 0.65, 2.10)
    const colliderMat = new THREE.MeshBasicMaterial({
      color: 0x00ffff,
      wireframe: true,
      depthTest: false,
      depthWrite: false,
      transparent: true,
      opacity: 0.85,
    })
    this.colliderWireframe = new THREE.Mesh(colliderGeo, colliderMat)
    this.colliderWireframe.position.set(0, 0.48, 0)
    this.colliderWireframe.renderOrder = 1000
    this.colliderWireframe.visible = this.showCollider
    this.group.add(this.colliderWireframe)
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

        for (let idx = 0; idx < LOCAL_PROBES.length; idx++) {
          const probe = LOCAL_PROBES[idx]
          const px = this.position.x + probe.x * rightX + probe.z * forwardX
          const py = this.position.y
          const pz = this.position.z + probe.x * rightZ + probe.z * forwardZ

          _tempSegment.start.set(px, py + radius, pz)
          _tempSegment.end.set(px, py + radius + height, pz)

          _tempCapsuleBounds.min.set(px - 1.5, py - 1.5, pz - 1.5)
          _tempCapsuleBounds.max.set(px + 1.5, py + radius + height + radius + 1.5, pz + 1.5)

          colliderBVH.shapecast({
            intersectsBounds: (box: THREE.Box3) => box.intersectsBox(_tempCapsuleBounds),
            intersectsTriangle: (tri: any) => {
              const distSq = tri.closestPointToSegment(_tempSegment, _tempVecA, _tempVecB)
              const dist = Math.sqrt(distSq)

              if (dist < radius) {
                const depth = radius - dist
                const direction = _tempVecB.sub(_tempVecA).normalize()
                if (direction.y > 0.3) {
                  touchGround = true
                }
                this.position.addScaledVector(direction, depth)
                if (Math.abs(direction.y) < 0.5) {
                  this.currentSpeed *= 0.8
                }
              }
            }
          })
        }

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

    // 5. Ramp Slope Detection via Vertical Ground Raycast
    let targetRampPitch = this.rampPitchAngle
    let targetRampRoll = this.rampRollAngle

    if (this.isOnGround && colliderBVH) {
      _tempRay.origin.set(this.position.x, this.position.y + SLOPE_CONFIG.rayOriginHeight, this.position.z)
      _tempRay.direction.set(0, -1, 0)
      const hit = colliderBVH.raycastFirst(_tempRay)

      if (hit && hit.distance < SLOPE_CONFIG.maxRayDistance && hit.face && hit.face.normal) {
        const groundNormal = hit.face.normal
        if (groundNormal.y > SLOPE_CONFIG.minNormalY) {
          _tempFwd.set(forwardX, 0, forwardZ)
          _tempRight.set(rightX, 0, rightZ)

          const clampVal = SLOPE_CONFIG.clampThreshold
          targetRampPitch = Math.asin(Math.max(-clampVal, Math.min(clampVal, _tempFwd.dot(groundNormal)))) * SLOPE_CONFIG.pitchMultiplier
          targetRampRoll = -Math.asin(Math.max(-clampVal, Math.min(clampVal, _tempRight.dot(groundNormal)))) * SLOPE_CONFIG.rollMultiplier
        }
      }
    } else if (!this.isOnGround) {
      targetRampPitch *= Math.max(0, 1.0 - SLOPE_CONFIG.airborneDecay * dt)
      targetRampRoll *= Math.max(0, 1.0 - SLOPE_CONFIG.airborneDecay * dt)
    }

    this.rampPitchAngle += (targetRampPitch - this.rampPitchAngle) * Math.min(1.0, SLOPE_CONFIG.lerpSpeed * dt)
    this.rampRollAngle += (targetRampRoll - this.rampRollAngle) * Math.min(1.0, SLOPE_CONFIG.lerpSpeed * dt)

    this.group.position.copy(this.position)
    _tempEuler.set(this.rampPitchAngle, this.rotationY, this.rampRollAngle, 'YXZ')
    this.group.quaternion.setFromEuler(_tempEuler)

    if (this.position.y < -10.0) {
      this.resetToOrigin()
    }
  }
}
