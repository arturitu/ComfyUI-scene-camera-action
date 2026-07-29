import * as THREE from 'three'

export abstract class BaseActor {
  public group: THREE.Group
  public position: THREE.Vector3 = new THREE.Vector3(0, -1.0, 2)
  public velocity: THREE.Vector3 = new THREE.Vector3(0, 0, 0)
  public rotationY: number = 0
  public isOnGround: boolean = true
  public colliderWireframe: THREE.Object3D | null = null
  public showCollider: boolean = false

  constructor() {
    this.group = new THREE.Group()
    this.group.name = 'actorGroup'
    this.group.position.copy(this.position)
  }

  public resetToOrigin(): void {
    this.position.set(0, -1.0, 2)
    this.rotationY = 0
    this.velocity.set(0, 0, 0)
    this.isOnGround = true
    this.group.position.copy(this.position)
    this.group.rotation.y = this.rotationY
  }

  public jump(): void {
    if (this.isOnGround) {
      this.velocity.y = 11.0
      this.isOnGround = false
    }
  }

  public setDisplayCollider(visible: boolean): void {
    this.showCollider = visible
    if (this.colliderWireframe) {
      this.colliderWireframe.visible = visible
    }
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

  /**
   * Universal ground raycasting & gravity resolution shared by all actors.
   * Uses exact vertical ray-triangle intersection to find floor height directly beneath (X, Z).
   */
  protected updateGroundAndGravity(dt: number, colliderBVH: any): void {
    let targetGroundY: number | null = null

    if (colliderBVH) {
      const ray = new THREE.Ray(
        new THREE.Vector3(this.position.x, this.position.y + 50.0, this.position.z),
        new THREE.Vector3(0, -1, 0)
      )
      const tempNormal = new THREE.Vector3()
      const hitPoint = new THREE.Vector3()

      let highestBelow: number | null = null
      let lowestAbove: number | null = null

      colliderBVH.shapecast({
        intersectsBounds: (box: THREE.Box3) => ray.intersectsBox(box),
        intersectsTriangle: (tri: any) => {
          tri.getNormal(tempNormal)
          if (tempNormal.y > 0.3) {
            if (ray.intersectTriangle(tri.a, tri.b, tri.c, false, hitPoint)) {
              if (hitPoint.y <= this.position.y + 1.2) {
                if (highestBelow === null || hitPoint.y > highestBelow) {
                  highestBelow = hitPoint.y
                }
              } else {
                if (lowestAbove === null || hitPoint.y < lowestAbove) {
                  lowestAbove = hitPoint.y
                }
              }
            }
          }
        }
      })

      if (highestBelow !== null) {
        targetGroundY = highestBelow
      } else if (lowestAbove !== null) {
        // Submerged inside/below a block: auto-pop up to the surface above!
        targetGroundY = lowestAbove
      }
    } else {
      // Default stage floor when no custom scene BVH is loaded
      if (Math.abs(this.position.x) <= 50.0 && Math.abs(this.position.z) <= 50.0) {
        targetGroundY = -1.0
      }
    }

    if (targetGroundY !== null) {
      if (this.position.y <= targetGroundY + 0.1) {
        // Landed or submerged inside floor: auto-pop onto surface
        this.position.y = targetGroundY
        this.velocity.y = 0
        this.isOnGround = true
      } else {
        // Falling in mid-air towards targetGroundY
        this.velocity.y -= 30.0 * dt
        this.position.y += this.velocity.y * dt
        if (this.position.y <= targetGroundY) {
          this.position.y = targetGroundY
          this.velocity.y = 0
          this.isOnGround = true
        } else {
          this.isOnGround = false
        }
      }
    } else {
      // Open void (no floor directly under footprint): apply gravity
      this.velocity.y -= 30.0 * dt
      this.position.y += this.velocity.y * dt
      this.isOnGround = false

      if (this.position.y < -10.0) {
        this.resetToOrigin()
      }
    }
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
