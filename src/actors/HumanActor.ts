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

    // 1. Human Body Mesh
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

    // 2. Nose Pointer Box (indicating front direction +Z)
    const noseGeo = new THREE.BoxGeometry(0.08, 0.08, 0.12)
    const noseMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.2,
      metalness: 0.1,
    })
    const noseMesh = new THREE.Mesh(noseGeo, noseMat)
    noseMesh.position.set(0, 1.15, 0.26)
    noseMesh.castShadow = true
    this.group.add(noseMesh)

    // 3. Human Collider Wireframe Visualizer
    const colliderGeo = new THREE.CapsuleGeometry(0.3, 0.9, 8, 16)
    const colliderMat = new THREE.MeshBasicMaterial({
      color: 0xff00ff,
      wireframe: true,
      depthTest: false,
      depthWrite: false,
      transparent: true,
      opacity: 0.85,
    })
    this.colliderWireframe = new THREE.Mesh(colliderGeo, colliderMat)
    this.colliderWireframe.position.y = 0.75
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
    const isSpace = keysPressed['Space'] || keysPressed[' '] || keysPressed['KeyJ']

    if (isSpace && this.isOnGround) {
      this.jump()
    }

    const physicsSteps = 5
    const stepDt = dt / physicsSteps
    const speed = speedMultiplier

    let moveZ = 0
    let moveX = 0

    if (isW) moveZ -= 1
    if (isS) moveZ += 1
    if (isA) moveX -= 1
    if (isD) moveX += 1

    const dir = new THREE.Vector3(moveX, 0, moveZ)
    if (dir.lengthSq() > 0) {
      dir.normalize()
      this.rotationY = Math.atan2(dir.x, dir.z)
      this.group.rotation.y = this.rotationY
    }

    this.velocity.x = dir.x * speed
    this.velocity.z = dir.z * speed

    let touchGround = false

    for (let step = 0; step < physicsSteps; step++) {
      this.velocity.y -= 30 * stepDt
      this.position.addScaledVector(this.velocity, stepDt)

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
        capsuleBounds.min.x -= 1.0
        capsuleBounds.min.z -= 1.0
        capsuleBounds.min.y -= 1.5
        capsuleBounds.max.copy(this.position)
        capsuleBounds.max.x += 1.0
        capsuleBounds.max.z += 1.0
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
              }
              tempSegment.start.addScaledVector(direction, depth)
              tempSegment.end.addScaledVector(direction, depth)
            }
          }
        })

        this.position.copy(tempSegment.start)
        this.position.y -= radius

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

    // Respawn if falling off stage edge into abyss
    if (this.position.y < -10.0) {
      this.resetToOrigin()
      return
    }

    this.group.position.copy(this.position)
  }
}
