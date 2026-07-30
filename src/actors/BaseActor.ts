import * as THREE from 'three'
import type { MotionFrame } from '../types'

// Static scratch instances to avoid per-frame GC allocations
const _tempEuler = new THREE.Euler()
const _tempRay = new THREE.Ray()
const _tempNormal = new THREE.Vector3()
const _tempHitPoint = new THREE.Vector3()

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
    this.group.rotation.set(0, ry, 0)
  }

  public getMotionState(t: number): MotionFrame {
    _tempEuler.setFromQuaternion(this.group.quaternion, 'YXZ')
    return {
      t: Number(t.toFixed(3)),
      px: Number(this.group.position.x.toFixed(3)),
      py: Number(this.group.position.y.toFixed(3)),
      pz: Number(this.group.position.z.toFixed(3)),
      rx: Number(_tempEuler.x.toFixed(3)),
      ry: Number(this.rotationY.toFixed(3)),
      rz: Number(_tempEuler.z.toFixed(3)),
    }
  }

  public applyMotionFrame(frame: any, diffY: number = 0): void {
    if (!frame) return

    const prevX = this.position.x
    const prevZ = this.position.z

    this.position.set(frame.px ?? 0, frame.py ?? -1.0, frame.pz ?? 0)
    this.rotationY = frame.ry ?? 0
    const rx = frame.rx ?? 0
    const rz = frame.rz ?? 0

    _tempEuler.set(rx, this.rotationY, rz, 'YXZ')
    this.group.quaternion.setFromEuler(_tempEuler)
    this.group.position.copy(this.position)

    const dx = this.position.x - prevX
    const dz = this.position.z - prevZ
    const distMoved = Math.sqrt(dx * dx + dz * dz)

    this.onPlaybackMotion(distMoved, diffY)
  }

  public onPlaybackMotion(_distMoved: number, _diffY: number): void {}

  /**
   * Universal ground raycasting & gravity resolution shared by all actors.
   * Uses exact vertical ray-triangle intersection to find floor height directly beneath (X, Z).
   */
  protected updateGroundAndGravity(dt: number, colliderBVH: any): void {
    let targetGroundY: number | null = null

    if (colliderBVH) {
      _tempRay.origin.set(this.position.x, this.position.y + 50.0, this.position.z)
      _tempRay.direction.set(0, -1, 0)

      let highestBelow: number | null = null
      let lowestAbove: number | null = null

      colliderBVH.shapecast({
        intersectsBounds: (box: THREE.Box3) => _tempRay.intersectsBox(box),
        intersectsTriangle: (tri: any) => {
          tri.getNormal(_tempNormal)
          if (_tempNormal.y > 0.3) {
            if (_tempRay.intersectTriangle(tri.a, tri.b, tri.c, false, _tempHitPoint)) {
              if (_tempHitPoint.y <= this.position.y + 1.2) {
                if (highestBelow === null || _tempHitPoint.y > highestBelow) {
                  highestBelow = _tempHitPoint.y
                }
              } else {
                if (lowestAbove === null || _tempHitPoint.y < lowestAbove) {
                  lowestAbove = _tempHitPoint.y
                }
              }
            }
          }
        }
      })

      if (highestBelow !== null) {
        targetGroundY = highestBelow
      } else if (lowestAbove !== null) {
        targetGroundY = lowestAbove
      }
    } else {
      if (Math.abs(this.position.x) <= 50.0 && Math.abs(this.position.z) <= 50.0) {
        targetGroundY = -1.0
      }
    }

    if (targetGroundY !== null) {
      if (this.position.y <= targetGroundY + 0.1) {
        this.position.y = targetGroundY
        this.velocity.y = 0
        this.isOnGround = true
      } else {
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
