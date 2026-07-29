import * as THREE from 'three'
import { BaseActor } from './BaseActor'

export class CarActor extends BaseActor {
  private currentSpeed: number = 0

  constructor() {
    super()
    this.rotationY = Math.PI / 2
    this.group.rotation.y = this.rotationY
    this.buildMesh()
  }

  public getType(): 'car' {
    return 'car'
  }

  public override resetToOrigin(): void {
    this.position.set(0, -1.0, 2)
    this.rotationY = Math.PI / 2
    this.velocity.set(0, 0, 0)
    this.currentSpeed = 0
    this.isOnGround = true
    this.group.position.copy(this.position)
    this.group.rotation.y = this.rotationY
  }

  public buildMesh(): void {
    while (this.group.children.length > 0) {
      const child = this.group.children[0]
      this.group.remove(child)
    }

    const carGroup = new THREE.Group()

    // 1. Car Body
    const bodyGeo = new THREE.BoxGeometry(1.0, 0.4, 1.8)
    const bodyMat = new THREE.MeshStandardMaterial({
      color: 0x0284c7,
      roughness: 0.3,
      metalness: 0.6,
    })
    const bodyMesh = new THREE.Mesh(bodyGeo, bodyMat)
    bodyMesh.position.y = 0.35
    bodyMesh.castShadow = true
    bodyMesh.receiveShadow = true
    carGroup.add(bodyMesh)

    // 2. Car Cabin
    const cabinGeo = new THREE.BoxGeometry(0.8, 0.35, 0.9)
    const cabinMat = new THREE.MeshStandardMaterial({
      color: 0x0f172a,
      roughness: 0.1,
      metalness: 0.8,
    })
    const cabinMesh = new THREE.Mesh(cabinGeo, cabinMat)
    cabinMesh.position.set(0, 0.65, -0.1)
    cabinMesh.castShadow = true
    cabinMesh.receiveShadow = true
    carGroup.add(cabinMesh)

    // 3. Headlights
    const headlightGeo = new THREE.BoxGeometry(0.2, 0.1, 0.05)
    const headlightMat = new THREE.MeshStandardMaterial({
      color: 0xfff066,
      emissive: 0xfff066,
      emissiveIntensity: 0.8,
    })
    const lightLeft = new THREE.Mesh(headlightGeo, headlightMat)
    lightLeft.position.set(-0.35, 0.35, 0.91)
    carGroup.add(lightLeft)

    const lightRight = new THREE.Mesh(headlightGeo, headlightMat)
    lightRight.position.set(0.35, 0.35, 0.91)
    carGroup.add(lightRight)

    // 4. Wheels (Raised slightly so wheels sit cleanly above the floor plane)
    const wheelGeo = new THREE.CylinderGeometry(0.2, 0.2, 0.15, 16)
    const wheelMat = new THREE.MeshStandardMaterial({
      color: 0x18181b,
      roughness: 0.8,
      metalness: 0.2,
    })

    const wheelPositions = [
      [-0.52, 0.2, 0.55],
      [0.52, 0.2, 0.55],
      [-0.52, 0.2, -0.55],
      [0.52, 0.2, -0.55],
    ]

    wheelPositions.forEach(([x, y, z]) => {
      const wheel = new THREE.Mesh(wheelGeo, wheelMat)
      wheel.rotation.z = Math.PI / 2
      wheel.position.set(x, y, z)
      wheel.castShadow = true
      carGroup.add(wheel)
    })

    // Raise mesh group slightly (+0.08m) so wheels sit cleanly above ground
    carGroup.position.y = 0.08
    this.group.add(carGroup)

    // 5. Car Collider Wireframe Visualizer (Clean vehicle bounding box)
    const colliderGeo = new THREE.BoxGeometry(1.05, 0.65, 1.85)
    const colliderMat = new THREE.MeshBasicMaterial({
      color: 0x00ffff,
      wireframe: true,
      depthTest: false,
      depthWrite: false,
      transparent: true,
      opacity: 0.85,
    })
    this.colliderWireframe = new THREE.Mesh(colliderGeo, colliderMat)
    this.colliderWireframe.position.set(0, 0.40, 0)
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
        // Fast brake when moving forward
        this.currentSpeed = Math.max(0, this.currentSpeed - brake)
      } else if (this.currentSpeed > -maxReverseSpeed) {
        // Reverse acceleration
        this.currentSpeed = Math.max(-maxReverseSpeed, this.currentSpeed - accel)
      }
    } else {
      // Inertia & Friction coasting deceleration when no throttle/brake is pressed
      if (this.currentSpeed > 0) {
        this.currentSpeed = Math.max(0, this.currentSpeed - drag)
      } else if (this.currentSpeed < 0) {
        this.currentSpeed = Math.min(0, this.currentSpeed + drag)
      }
    }

    // 2. Steering logic (turns only when moving)
    let steerInput = 0
    if (isA) steerInput += 1
    if (isD) steerInput -= 1

    if (steerInput !== 0 && Math.abs(this.currentSpeed) > 0.05) {
      const turnDir = this.currentSpeed < 0 ? -1 : 1
      const turnFactor = Math.min(1.0, Math.abs(this.currentSpeed) / 3.0)
      this.rotationY += steerInput * turnDir * 2.2 * turnFactor * dt
      this.group.rotation.y = this.rotationY
    }

    // 3. Movement integration along forward vector
    this.velocity.x = Math.sin(this.rotationY) * this.currentSpeed
    this.velocity.z = Math.cos(this.rotationY) * this.currentSpeed

    const physicsSteps = 5
    const stepDt = dt / physicsSteps

    for (let step = 0; step < physicsSteps; step++) {
      this.velocity.y -= 30 * stepDt
      const tentativeY = this.position.y
      this.position.addScaledVector(this.velocity, stepDt)

      if (colliderBVH) {
        const radius = 0.35
        const height = 0.3

        const tempSegment = new THREE.Line3()
        tempSegment.start.copy(this.position)
        tempSegment.start.y += radius

        tempSegment.end.copy(this.position)
        tempSegment.end.y += radius + height

        const capsuleBounds = new THREE.Box3()
        capsuleBounds.min.copy(this.position)
        capsuleBounds.min.x -= 1.5
        capsuleBounds.min.z -= 1.5
        capsuleBounds.min.y -= 1.5
        capsuleBounds.max.copy(this.position)
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
              tempSegment.start.addScaledVector(direction, depth)
              tempSegment.end.addScaledVector(direction, depth)
            }
          }
        })

        const resolvedY = tempSegment.start.y - radius
        const deltaY = resolvedY - tentativeY
        if (deltaY > 0.001) {
          if (this.velocity.y <= 0) {
            this.velocity.y = 0
            this.isOnGround = true
          }
        } else if (deltaY < -0.001) {
          if (this.velocity.y > 0) {
            this.velocity.y = 0
          }
        }

        this.position.copy(tempSegment.start)
        this.position.y -= radius
      }

      // ABSOLUTE SAFETY FLOOR CHECK: Never allow sinking below stage ground y = -1.0
      if (this.position.y < -1.0) {
        this.position.y = -1.0
        this.velocity.y = 0
        this.isOnGround = true
      }
    }

    if (this.position.y < -10.0) {
      this.resetToOrigin()
      return
    }

    this.group.position.copy(this.position)
  }
}
