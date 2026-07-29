import * as THREE from 'three'
import { BaseActor } from './BaseActor'

export class CarActor extends BaseActor {
  constructor() {
    super()
    this.buildMesh()
  }

  public getType(): 'car' {
    return 'car'
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

    // 4. Wheels
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

    this.group.add(carGroup)
  }

  public updatePhysics(
    dt: number,
    keysPressed: Record<string, boolean>,
    speedMultiplier: number,
    colliderBVH: any
  ): void {
    let forwardSpeed = 0
    if (keysPressed['ArrowUp'] || keysPressed['KeyW']) {
      forwardSpeed = speedMultiplier * 1.2
    } else if (keysPressed['ArrowDown'] || keysPressed['KeyS']) {
      forwardSpeed = -speedMultiplier * 0.6
    }

    let steerInput = 0
    if (keysPressed['ArrowLeft'] || keysPressed['KeyA']) steerInput += 1
    if (keysPressed['ArrowRight'] || keysPressed['KeyD']) steerInput -= 1

    if (steerInput !== 0) {
      const turnDir = forwardSpeed < 0 ? -1 : 1
      this.rotationY += steerInput * turnDir * 2.5 * dt
      this.group.rotation.y = this.rotationY
    }

    if (forwardSpeed !== 0) {
      this.velocity.x = Math.sin(this.rotationY) * forwardSpeed
      this.velocity.z = Math.cos(this.rotationY) * forwardSpeed
      this.velocity.y = 0

      this.position.addScaledVector(this.velocity, dt)
    } else {
      this.velocity.set(0, 0, 0)
    }

    this.position.y = -1.0
    this.position.x = Math.max(-24, Math.min(24, this.position.x))
    this.position.z = Math.max(-24, Math.min(24, this.position.z))

    if (colliderBVH && forwardSpeed !== 0) {
      const tempVector = new THREE.Vector3()
      const carBox = new THREE.Box3().setFromObject(this.group)
      colliderBVH.shapecast({
        intersectsBounds: (box: THREE.Box3) => box.intersectsBox(carBox),
        intersectsTriangle: (tri: any) => {
          const triNormal = tempVector
          tri.getNormal(triNormal)
          if (triNormal.y > 0.5) return

          const triPoint = new THREE.Vector3()
          tri.closestPointToPoint(this.position, triPoint)
          const flatPos = new THREE.Vector2(this.position.x, this.position.z)
          const flatTri = new THREE.Vector2(triPoint.x, triPoint.z)
          const distSq = flatPos.distanceToSquared(flatTri)
          
          if (distSq < 0.64) {
            const dist = Math.sqrt(distSq)
            if (dist > 0.001) {
              const push = flatPos.sub(flatTri).normalize().multiplyScalar((0.8 - dist) * 0.5)
              this.position.x += push.x
              this.position.z += push.y
            }
          }
        }
      })
    }

    this.group.position.copy(this.position)
  }
}
