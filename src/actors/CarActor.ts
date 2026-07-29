import * as THREE from 'three'
import { BaseActor } from './BaseActor'

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
    this.rotationY = 0
    this.group.rotation.y = 0
    this.buildMesh()
  }

  public getType(): 'car' {
    return 'car'
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

    // Suspension Pitch (+3° maintained forward, -2° maintained reverse) & Roll (Turning) during Playback
    const normalizedSpeed = Math.min(1.0, Math.abs(currentSpeed) / 6.0)
    const lateralRatio = Math.max(-1.0, Math.min(1.0, angularVel * 0.5 * normalizedSpeed))

    let targetPitch = 0
    if (currentSpeed > 0.05) {
      // Forward cruising: maintain nose UP (+3°, -0.052 rad in Three.js)
      targetPitch = -0.052 * normalizedSpeed
    } else if (currentSpeed < -0.05) {
      // Reverse cruising: maintain nose DOWN (-2°, +0.035 rad in Three.js)
      targetPitch = 0.035 * normalizedSpeed
    }

    // Add transient acceleration / braking dynamics
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
    this.position.set(0, -1.0, 2)
    this.rotationY = 0
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
      const child = this.group.children[0]
      this.group.remove(child)
    }

    const carGroup = new THREE.Group()
    this.bodySuspensionGroup = new THREE.Group()

    // 1. Car Body
    const bodyGeo = new THREE.BoxGeometry(1.0, 0.4, 1.8)
    const bodyMat = new THREE.MeshStandardMaterial({
      color: 0x0284c7,
      roughness: 0.4,
      metalness: 0.1,
    })
    const bodyMesh = new THREE.Mesh(bodyGeo, bodyMat)
    bodyMesh.position.y = 0.35
    bodyMesh.castShadow = true
    bodyMesh.receiveShadow = true
    this.bodySuspensionGroup.add(bodyMesh)

    // 2. Car Cabin (ExtrudeGeometry parallelepiped with slanted windshield at front & steeper window at rear)
    const cabinShape = new THREE.Shape()
    cabinShape.moveTo(-0.45, 0.0)   // Aerodynamic front windshield bottom (+Z, yellow lights side)
    cabinShape.lineTo(-0.12, 0.38)  // Slanted front windshield (~49° angle)
    cabinShape.lineTo(0.35, 0.38)   // Flat roof top
    cabinShape.lineTo(0.45, 0.0)   // Steeper rear window angle (~75°, red lights side)
    cabinShape.closePath()

    const cabinExtrudeSettings: THREE.ExtrudeGeometryOptions = {
      depth: 0.80,
      bevelEnabled: true,
      bevelThickness: 0.02,
      bevelSize: 0.02,
      bevelSegments: 2
    }
    const cabinGeo = new THREE.ExtrudeGeometry(cabinShape, cabinExtrudeSettings)
    cabinGeo.rotateY(Math.PI / 2)
    cabinGeo.translate(-0.40, 0.55, -0.05)

    const cabinMat = new THREE.MeshStandardMaterial({
      color: 0x0284c7,
      roughness: 0.4,
      metalness: 0.1,
    })
    const cabinMesh = new THREE.Mesh(cabinGeo, cabinMat)
    cabinMesh.castShadow = true
    cabinMesh.receiveShadow = true
    this.bodySuspensionGroup.add(cabinMesh)

    // 3. Headlights (Yellow, Front +Z)
    const headlightGeo = new THREE.BoxGeometry(0.2, 0.1, 0.05)
    const headlightMat = new THREE.MeshStandardMaterial({
      color: 0xfff066,
      emissive: 0xfff066,
      emissiveIntensity: 0.8,
    })
    const lightLeft = new THREE.Mesh(headlightGeo, headlightMat)
    lightLeft.position.set(-0.35, 0.35, 0.91)
    this.bodySuspensionGroup.add(lightLeft)

    const lightRight = new THREE.Mesh(headlightGeo, headlightMat)
    lightRight.position.set(0.35, 0.35, 0.91)
    this.bodySuspensionGroup.add(lightRight)

    // 3b. Brake Lights (Smaller, less emissive, Rear -Z)
    const brakelightGeo = new THREE.BoxGeometry(0.12, 0.10, 0.03)
    const brakelightMat = new THREE.MeshStandardMaterial({
      color: 0xdc2626,
      emissive: 0xdc2626,
      emissiveIntensity: 0.2,
    })
    const brakeLeft = new THREE.Mesh(brakelightGeo, brakelightMat)
    brakeLeft.position.set(-0.35, 0.35, -0.91)
    this.bodySuspensionGroup.add(brakeLeft)

    const brakeRight = new THREE.Mesh(brakelightGeo, brakelightMat)
    brakeRight.position.set(0.35, 0.35, -0.91)
    this.bodySuspensionGroup.add(brakeRight)

    // 3c. Side Rearview Mirrors (Sticking out sideways on X, thin front-to-back on Z)
    const mirrorGeo = new THREE.BoxGeometry(0.14, 0.08, 0.05)
    const mirrorMat = new THREE.MeshStandardMaterial({
      color: 0xe2e8f0,
      roughness: 0.4,
      metalness: 0.1,
    })
    const mirrorLeft = new THREE.Mesh(mirrorGeo, mirrorMat)
    mirrorLeft.position.set(-0.47, 0.65, 0.20)
    mirrorLeft.castShadow = true
    this.bodySuspensionGroup.add(mirrorLeft)

    const mirrorRight = new THREE.Mesh(mirrorGeo, mirrorMat)
    mirrorRight.position.set(0.47, 0.65, 0.20)
    mirrorRight.castShadow = true
    this.bodySuspensionGroup.add(mirrorRight)

    carGroup.add(this.bodySuspensionGroup)

    // 4. Wheels: Black ExtrudeGeometry Tire (Hollow Ring) + White Cylinder Hub Rim
    const tireShape = new THREE.Shape()
    tireShape.absarc(0, 0, 0.20, 0, Math.PI * 2, false)

    const tireHole = new THREE.Path()
    tireHole.absarc(0, 0, 0.09, 0, Math.PI * 2, true)
    tireShape.holes.push(tireHole)

    const extrudeSettings = {
      depth: 0.18,
      bevelEnabled: false,
      curveSegments: 16,
    }

    const tireGeo = new THREE.ExtrudeGeometry(tireShape, extrudeSettings)
    tireGeo.center()

    const tireMat = new THREE.MeshStandardMaterial({
      color: 0x18181b,
      roughness: 0.6,
      metalness: 0.1,
    })

    const hubGeo = new THREE.CylinderGeometry(0.09, 0.09, 0.18, 16)
    const hubMat = new THREE.MeshStandardMaterial({
      color: 0xf1f5f9,
      roughness: 0.4,
      metalness: 0.1,
    })

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

    // Front Left (+x, +z)
    this.frontLeftWheelGroup = createWheelAssembly()
    this.frontLeftWheelGroup.position.set(-0.52, 0.2, 0.55)
    carGroup.add(this.frontLeftWheelGroup)

    // Front Right (-x, +z)
    this.frontRightWheelGroup = createWheelAssembly()
    this.frontRightWheelGroup.position.set(0.52, 0.2, 0.55)
    carGroup.add(this.frontRightWheelGroup)

    // Rear Left (+x, -z)
    this.rearLeftWheelGroup = createWheelAssembly()
    this.rearLeftWheelGroup.position.set(-0.52, 0.2, -0.55)
    carGroup.add(this.rearLeftWheelGroup)

    // Rear Right (-x, -z)
    this.rearRightWheelGroup = createWheelAssembly()
    this.rearRightWheelGroup.position.set(0.52, 0.2, -0.55)
    carGroup.add(this.rearRightWheelGroup)

    // Elevate carGroup (+0.22m) so wheels rest cleanly above ground plane
    carGroup.position.y = 0.22
    this.group.add(carGroup)

    // 5. Car Collider Wireframe Visualizer (With safety padding margin)
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

    // 1. Acceleration / Braking / Reversing / Inertia logic
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

    // 2. Steering logic (turns car orientation when moving)
    let steerInput = 0
    if (isA) steerInput += 1
    if (isD) steerInput -= 1

    if (steerInput !== 0 && Math.abs(this.currentSpeed) > 0.05) {
      const turnDir = this.currentSpeed < 0 ? -1 : 1
      const turnFactor = Math.min(1.0, Math.abs(this.currentSpeed) / 3.0)
      this.rotationY += steerInput * turnDir * 2.2 * turnFactor * dt
    }

    // 3. Visual Steering Angle for Front Wheels
    let targetSteer = 0
    if (isA) targetSteer += 0.45
    if (isD) targetSteer -= 0.45

    this.currentSteerAngle += (targetSteer - this.currentSteerAngle) * Math.min(1.0, 15.0 * dt)

    if (this.frontLeftWheelGroup) {
      this.frontLeftWheelGroup.rotation.y = this.currentSteerAngle
    }
    if (this.frontRightWheelGroup) {
      this.frontRightWheelGroup.rotation.y = this.currentSteerAngle
    }

    // Roll all 4 wheels based on current movement speed
    if (Math.abs(this.currentSpeed) > 0.01) {
      const rollDelta = (this.currentSpeed * dt) / 0.2
      this.wheelRollingGroup.forEach((w) => {
        w.rotation.x += rollDelta
      })
    }

    // 3b. Suspension Pitch (+3° maintained forward, -2° maintained reverse) & Roll (Turning)
    const speedDelta = (this.currentSpeed - this.prevSpeed) / Math.max(0.001, dt)
    this.prevSpeed = this.currentSpeed

    const speedRatio = Math.min(1.0, Math.abs(this.currentSpeed) / Math.max(0.1, maxForwardSpeed))
    const normalizedTurn = Math.max(-1.0, Math.min(1.0, (this.currentSteerAngle / 0.45) * speedRatio))

    let targetPitch = 0
    if (this.currentSpeed > 0.05) {
      // Forward cruising: maintain nose UP (+3°, -0.052 rad in Three.js)
      targetPitch = -0.052 * speedRatio
    } else if (this.currentSpeed < -0.05) {
      // Reverse cruising: maintain nose DOWN (-2°, +0.035 rad in Three.js)
      targetPitch = 0.035 * speedRatio
    }

    // Add transient acceleration / braking dynamics
    targetPitch += Math.max(-0.04, Math.min(0.04, speedDelta * -0.003))

    // Roll: body leans out during turn and holds lean until straight again
    const targetRoll = -0.09 * normalizedTurn

    this.pitchAngle += (targetPitch - this.pitchAngle) * Math.min(1.0, 10.0 * dt)
    this.rollAngle += (targetRoll - this.rollAngle) * Math.min(1.0, 10.0 * dt)

    if (this.bodySuspensionGroup) {
      this.bodySuspensionGroup.rotation.x = this.pitchAngle
      this.bodySuspensionGroup.rotation.z = this.rollAngle
    }

    // 4. Movement integration along forward vector
    this.velocity.x = Math.sin(this.rotationY) * this.currentSpeed
    this.velocity.z = Math.cos(this.rotationY) * this.currentSpeed

    const physicsSteps = 5
    const stepDt = dt / physicsSteps

    let touchGround = false
    const groundNormal = new THREE.Vector3(0, 0, 0)
    let normalCount = 0

    for (let step = 0; step < physicsSteps; step++) {
      this.velocity.y -= 30 * stepDt
      this.position.addScaledVector(this.velocity, stepDt)

      if (colliderBVH) {
        const radius = 0.38
        const height = 0.20

        const forwardX = Math.sin(this.rotationY)
        const forwardZ = Math.cos(this.rotationY)
        const rightX = Math.cos(this.rotationY)
        const rightZ = -Math.sin(this.rotationY)

        // 5 local probe offsets: 4 corners (with generous safety margin) + 1 center
        const localProbes = [
          { x: -0.38, z: 0.72 },  // 0: Front-Left
          { x: 0.38, z: 0.72 },   // 1: Front-Right
          { x: -0.38, z: -0.72 }, // 2: Rear-Left
          { x: 0.38, z: -0.72 },  // 3: Rear-Right
          { x: 0.0, z: 0.0 },     // 4: Center
        ]

        for (let idx = 0; idx < localProbes.length; idx++) {
          const probe = localProbes[idx]
          const probePos = this.position.clone().add(
            new THREE.Vector3(
              probe.x * rightX + probe.z * forwardX,
              0,
              probe.x * rightZ + probe.z * forwardZ
            )
          )

          const tempSegment = new THREE.Line3()
          tempSegment.start.copy(probePos)
          tempSegment.start.y += radius

          tempSegment.end.copy(probePos)
          tempSegment.end.y += radius + height

          const capsuleBounds = new THREE.Box3()
          capsuleBounds.min.copy(probePos)
          capsuleBounds.min.x -= 1.5
          capsuleBounds.min.z -= 1.5
          capsuleBounds.min.y -= 1.5
          capsuleBounds.max.copy(probePos)
          capsuleBounds.max.x += 1.5
          capsuleBounds.max.z += 1.5
          capsuleBounds.max.y += radius + height + radius + 1.5

          const tempVector = new THREE.Vector3()
          const tempVector2 = new THREE.Vector3()

          colliderBVH.shapecast({
            intersectsBounds: (box: THREE.Box3) => box.intersectsBox(capsuleBounds),
            intersectsTriangle: (tri: any) => {
              const triPoint = tempVector
              const capsulePoint = tempVector2
              const distSq = tri.closestPointToSegment(tempSegment, triPoint, capsulePoint)
              const dist = Math.sqrt(distSq)

              if (dist < radius) {
                const depth = radius - dist
                const direction = capsulePoint.sub(triPoint).normalize()
                if (direction.y > 0.3) {
                  touchGround = true
                  groundNormal.add(direction)
                  normalCount++
                }
                this.position.addScaledVector(direction, depth)
                if (Math.abs(direction.y) < 0.5) {
                  this.currentSpeed *= 0.8
                }
              }
            }
          })
        }

        if (touchGround) {
          if (this.velocity.y <= 0) {
            this.velocity.y = 0
            this.isOnGround = true
          }
        }
      } else {
        if (this.position.y <= -1.0) {
          this.position.y = -1.0
          this.velocity.y = 0
          this.isOnGround = true
          touchGround = true
        }
      }
    }

    if (!touchGround && colliderBVH) {
      this.isOnGround = false
    }

    let targetRampPitch = this.rampPitchAngle
    let targetRampRoll = this.rampRollAngle

    if (this.isOnGround) {
      if (normalCount > 0) {
        groundNormal.normalize()
      } else {
        groundNormal.set(0, 1, 0)
      }

      const fwd = new THREE.Vector3(Math.sin(this.rotationY), 0, Math.cos(this.rotationY))
      const right = new THREE.Vector3(Math.cos(this.rotationY), 0, -Math.sin(this.rotationY))

      // dot > 0 means normal points forward (uphill). Math.asin returns positive.
      // We want positive pitch to mean nose-down, negative to mean nose-up.
      // So if uphill, we want negative rotation.
      targetRampPitch = Math.asin(Math.max(-0.99, Math.min(0.99, fwd.dot(groundNormal))))
      targetRampRoll = -Math.asin(Math.max(-0.99, Math.min(0.99, right.dot(groundNormal))))
    } else {
      targetRampPitch = 0
      targetRampRoll = 0
    }

    this.rampPitchAngle += (targetRampPitch - this.rampPitchAngle) * Math.min(1.0, 10.0 * dt)
    this.rampRollAngle += (targetRampRoll - this.rampRollAngle) * Math.min(1.0, 10.0 * dt)

    this.group.position.copy(this.position)
    const euler = new THREE.Euler(this.rampPitchAngle, this.rotationY, this.rampRollAngle, 'YXZ')
    this.group.quaternion.setFromEuler(euler)

    if (this.position.y < -10.0) {
      this.resetToOrigin()
      return
    }
  }
}
