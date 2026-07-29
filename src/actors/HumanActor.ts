import * as THREE from 'three'
import { BaseActor } from './BaseActor'

export class HumanActor extends BaseActor {
  constructor() {
    super()
    this.buildMesh()
  }

  public getType(): 'human' {
    return 'human'
  }

  public buildMesh(): void {
    while (this.group.children.length > 0) {
      const child = this.group.children[0]
      this.group.remove(child)
    }

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
    this.group.add(bodyMesh)
  }

  public updatePhysics(
    dt: number,
    keysPressed: Record<string, boolean>,
    speedMultiplier: number,
    colliderBVH: any
  ): void {
    const physicsSteps = 5
    const stepDt = dt / physicsSteps
    const speed = speedMultiplier

    let moveZ = 0
    let moveX = 0

    if (keysPressed['ArrowUp'] || keysPressed['KeyW']) moveZ -= 1
    if (keysPressed['ArrowDown'] || keysPressed['KeyS']) moveZ += 1
    if (keysPressed['ArrowLeft'] || keysPressed['KeyA']) moveX -= 1
    if (keysPressed['ArrowRight'] || keysPressed['KeyD']) moveX += 1

    const dir = new THREE.Vector3(moveX, 0, moveZ)
    if (dir.lengthSq() > 0) {
      dir.normalize()
      this.rotationY = Math.atan2(dir.x, dir.z)
      this.group.rotation.y = this.rotationY
    }

    this.velocity.x = dir.x * speed
    this.velocity.z = dir.z * speed

    for (let step = 0; step < physicsSteps; step++) {
      this.velocity.y -= 30 * stepDt
      const tentativeY = this.position.y
      this.position.addScaledVector(this.velocity, stepDt)

      if (this.position.y < -1.0) {
        this.position.y = -1.0
        this.velocity.y = 0
        this.isOnGround = true
      }

      this.position.x = Math.max(-24, Math.min(24, this.position.x))
      this.position.z = Math.max(-24, Math.min(24, this.position.z))

      if (colliderBVH) {
        const radius = 0.3
        const height = 0.9

        const tempSegment = new THREE.Line3()
        tempSegment.start.copy(this.position)
        tempSegment.start.y += radius

        tempSegment.end.copy(this.position)
        tempSegment.end.y += radius + height

        const capsuleBounds = new THREE.Box3()
        capsuleBounds.min.copy(this.position)
        capsuleBounds.min.x -= radius
        capsuleBounds.min.z -= radius
        capsuleBounds.max.copy(this.position)
        capsuleBounds.max.x += radius
        capsuleBounds.max.z += radius
        capsuleBounds.max.y += radius + height + radius

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
    }

    this.group.position.copy(this.position)
  }
}
