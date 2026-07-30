import * as THREE from 'three'
import { BaseActor } from './BaseActor'

// Module-level static scratch objects to eliminate Garbage Collection allocations per frame
const _tempDir = new THREE.Vector3()
const _tempVecA = new THREE.Vector3()
const _tempVecB = new THREE.Vector3()
const _tempSegment = new THREE.Line3()
const _tempCapsuleBounds = new THREE.Box3()

export class HumanActor extends BaseActor {
  constructor() {
    super()
    this.buildMesh()
  }

  public getType(): 'human' {
    return 'human'
  }

  public override onPlaybackMotion(_distMoved: number, _diffY: number): void {}

  public buildMesh(): void {
    while (this.group.children.length > 0) {
      this.group.remove(this.group.children[0])
    }

    // 1. Human Body Mesh
    const bodyGeo = new THREE.CapsuleGeometry(0.25, 0.85, 8, 16)
    const bodyMat = new THREE.MeshStandardMaterial({
      color: 0xff007f,
      roughness: 0.4,
      metalness: 0.1,
    })
    const bodyMesh = new THREE.Mesh(bodyGeo, bodyMat)
    bodyMesh.position.y = 0.85
    bodyMesh.castShadow = true
    bodyMesh.receiveShadow = true
    this.group.add(bodyMesh)

    // 2. Nose Pointer Box (front indicator +Z)
    const noseGeo = new THREE.BoxGeometry(0.08, 0.08, 0.12)
    const noseMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.4,
      metalness: 0.1,
    })
    const noseMesh = new THREE.Mesh(noseGeo, noseMat)
    noseMesh.position.set(0, 1.15, 0.26)
    noseMesh.castShadow = true
    this.group.add(noseMesh)

    // 3. Human Collider Wireframe Visualizer
    const colliderGeo = new THREE.CapsuleGeometry(0.45, 0.9, 8, 16)
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

    _tempDir.set(moveX, 0, moveZ)
    if (_tempDir.lengthSq() > 0) {
      _tempDir.normalize()
      this.rotationY = Math.atan2(_tempDir.x, _tempDir.z)
      this.group.rotation.y = this.rotationY
    }

    this.velocity.x = _tempDir.x * speed
    this.velocity.z = _tempDir.z * speed

    let touchGround = false

    for (let step = 0; step < physicsSteps; step++) {
      this.velocity.y -= 30 * stepDt
      this.position.addScaledVector(this.velocity, stepDt)

      if (colliderBVH) {
        const radius = 0.45
        const height = 0.9

        _tempSegment.start.copy(this.position)
        _tempSegment.start.y += radius
        _tempSegment.end.copy(this.position)
        _tempSegment.end.y += radius + height

        _tempCapsuleBounds.min.set(this.position.x - 1.0, this.position.y - 1.5, this.position.z - 1.0)
        _tempCapsuleBounds.max.set(this.position.x + 1.0, this.position.y + radius + height + radius + 1.5, this.position.z + 1.0)

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
              _tempSegment.start.addScaledVector(direction, depth)
              _tempSegment.end.addScaledVector(direction, depth)
            }
          }
        })

        this.position.copy(_tempSegment.start)
        this.position.y -= radius

        if (touchGround && this.velocity.y <= 0) {
          this.velocity.y = 0
          this.isOnGround = true
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

    if (this.position.y < -10.0) {
      this.resetToOrigin()
      return
    }

    this.group.position.copy(this.position)
  }
}
