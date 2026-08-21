import * as THREE from 'three'
import * as config from '../threeConfig'

export interface SpringArmResult {
  cameraPosition: THREE.Vector3
  targetLookAt: THREE.Vector3
  hitObstacle: boolean
  hitDistance: number
  ditherOpacity: number
}

export class CameraSpringArm {
  private currentDistance: number = -1
  private currentDitherOpacity: number = 1.0
  private raycaster = new THREE.Raycaster()
  private cameraRight = new THREE.Vector3()
  private cameraUp = new THREE.Vector3()
  private boomDir = new THREE.Vector3()
  private tempVec = new THREE.Vector3()
  private probeOrigin = new THREE.Vector3()
  private probeTarget = new THREE.Vector3()

  public reset(): void {
    this.currentDistance = -1
    this.currentDitherOpacity = 1.0
  }

  public getCurrentDistance(): number {
    return this.currentDistance
  }

  public getCurrentDitherOpacity(): number {
    return this.currentDitherOpacity
  }

  /**
   * Evaluates collision and computes the obstruction-free camera position.
   */
  public evaluate(
    targetLookAt: THREE.Vector3,
    idealCamPos: THREE.Vector3,
    obstacleRoot: THREE.Object3D | null,
    dt: number,
    isHardCut: boolean = false
  ): SpringArmResult {
    const idealDistance = targetLookAt.distanceTo(idealCamPos)
    if (idealDistance < 0.001) {
      return {
        cameraPosition: idealCamPos.clone(),
        targetLookAt: targetLookAt.clone(),
        hitObstacle: false,
        hitDistance: idealDistance,
        ditherOpacity: 1.0
      }
    }

    this.boomDir.subVectors(idealCamPos, targetLookAt).normalize()

    // Calculate right and up perpendicular vectors relative to boom
    this.cameraUp.set(0, 1, 0)
    this.cameraRight.crossVectors(this.boomDir, this.cameraUp).normalize()
    if (this.cameraRight.lengthSq() < 0.001) {
      this.cameraRight.set(1, 0, 0)
    }
    this.cameraUp.crossVectors(this.cameraRight, this.boomDir).normalize()

    let closestHitDistance = idealDistance
    let hitObstacle = false

    if (obstacleRoot && obstacleRoot.visible) {
      const colliders: THREE.Object3D[] = []
      obstacleRoot.traverse((child) => {
        if ((child as THREE.Mesh).isMesh && child.visible && child.name !== 'floor') {
          colliders.push(child)
        }
      })

      if (colliders.length > 0) {
        const r = config.SPRING_ARM_COLLISION_RADIUS
        // 5 multi-probe ray sweeps (Center + cross perimeter)
        const probeOffsets: THREE.Vector3[] = [
          new THREE.Vector3(0, 0, 0),
          this.cameraRight.clone().multiplyScalar(r),
          this.cameraRight.clone().multiplyScalar(-r),
          this.cameraUp.clone().multiplyScalar(r * 0.75),
          this.cameraUp.clone().multiplyScalar(-r * 0.5),
        ]

        for (const offset of probeOffsets) {
          this.probeOrigin.copy(targetLookAt).addScaledVector(offset, 0.4) // start slightly in front of actor center
          this.probeTarget.copy(idealCamPos).add(offset)

          const probeVec = this.tempVec.subVectors(this.probeTarget, this.probeOrigin)
          const maxProbeDist = probeVec.length()
          if (maxProbeDist < 0.001) continue

          const probeDir = probeVec.normalize()
          this.raycaster.set(this.probeOrigin, probeDir)
          this.raycaster.near = 0.05
          this.raycaster.far = maxProbeDist

          const hits = this.raycaster.intersectObjects(colliders, false)
          if (hits.length > 0) {
            const hit = hits[0]
            if (hit.distance < closestHitDistance) {
              closestHitDistance = hit.distance
              hitObstacle = true
            }
          }
        }
      }
    }

    // Calculate target distance with safety margin and minimum clamp
    let desiredDistance = idealDistance
    if (hitObstacle) {
      desiredDistance = Math.max(
        config.SPRING_ARM_MIN_DISTANCE,
        closestHitDistance - config.SPRING_ARM_SAFETY_MARGIN
      )
    }

    // Asymmetric spring smoothing: fast snap in, smooth recovery out
    if (isHardCut || this.currentDistance < 0) {
      this.currentDistance = desiredDistance
    } else {
      const isCompressing = desiredDistance < this.currentDistance
      const speed = isCompressing ? config.SPRING_ARM_ZOOM_IN_SPEED : config.SPRING_ARM_ZOOM_OUT_SPEED
      const factor = 1.0 - Math.exp(-speed * Math.max(0.001, dt))
      this.currentDistance += (desiredDistance - this.currentDistance) * factor
    }

    // Target Dither Opacity (fade nearby/intervening assets smoothly if close)
    let targetDither = 1.0
    if (hitObstacle && this.currentDistance < config.SPRING_ARM_OTS_THRESHOLD) {
      targetDither = Math.max(
        0.25,
        (this.currentDistance - config.SPRING_ARM_MIN_DISTANCE) /
          (config.SPRING_ARM_OTS_THRESHOLD - config.SPRING_ARM_MIN_DISTANCE)
      )
    }
    const ditherFactor = 1.0 - Math.exp(-15.0 * Math.max(0.001, dt))
    this.currentDitherOpacity += (targetDither - this.currentDitherOpacity) * ditherFactor

    // Position along boom vector
    const finalCamPos = targetLookAt.clone().addScaledVector(this.boomDir, this.currentDistance)
    const finalLookAt = targetLookAt.clone()

    // OTS & Smart Elevation blend when distance is tight (< OTS_THRESHOLD)
    if (this.currentDistance < config.SPRING_ARM_OTS_THRESHOLD) {
      const otsAlpha = Math.max(
        0,
        Math.min(
          1,
          1.0 -
            (this.currentDistance - config.SPRING_ARM_MIN_DISTANCE) /
              (config.SPRING_ARM_OTS_THRESHOLD - config.SPRING_ARM_MIN_DISTANCE)
        )
      )
      const shoulderOffset = this.cameraRight.clone().multiplyScalar(0.28 * otsAlpha)
      const elevationOffset = this.cameraUp.clone().multiplyScalar(0.12 * otsAlpha)

      finalCamPos.add(shoulderOffset).add(elevationOffset)
      finalLookAt.add(shoulderOffset.clone().multiplyScalar(0.5)).add(elevationOffset.clone().multiplyScalar(0.5))
    }

    return {
      cameraPosition: finalCamPos,
      targetLookAt: finalLookAt,
      hitObstacle,
      hitDistance: closestHitDistance,
      ditherOpacity: this.currentDitherOpacity
    }
  }
}
