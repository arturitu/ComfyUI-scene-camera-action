import * as THREE from 'three'

export abstract class BaseActor {
  public group: THREE.Group
  public position: THREE.Vector3 = new THREE.Vector3(0, -1.0, 2)
  public velocity: THREE.Vector3 = new THREE.Vector3(0, 0, 0)
  public rotationY: number = 0
  public isOnGround: boolean = true

  constructor() {
    this.group = new THREE.Group()
    this.group.name = 'actorGroup'
    this.group.position.copy(this.position)
  }

  abstract buildMesh(): void
  abstract updatePhysics(
    dt: number,
    keysPressed: Record<string, boolean>,
    speedMultiplier: number,
    colliderBVH: any
  ): void
  abstract getType(): 'human' | 'car'

  public setPosition(x: number, y: number, z: number, ry: number): void {
    this.position.set(x, y, z)
    this.rotationY = ry
    this.group.position.copy(this.position)
    this.group.rotation.y = ry
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
