import * as THREE from 'three'
import { SkinnedActor } from './SkinnedActor'
import type { RampSlopeConfig } from './BaseActor'

import quadrupedCubesGlb from '../assets/models/quadruped-cubes-rigged.glb'
import quadrupedAnimsGlb from '../assets/models/quadruped-animations.glb'

export class QuadrupedActor extends SkinnedActor {
  public override walkBaseSpeed: number = 4.5
  public override sprintBaseSpeed: number = 8.5
  public override crouchWalkBaseSpeed: number = 2.5

  constructor() {
    super()
    this.buildMesh()
  }

  public getType(): 'quadruped' {
    return 'quadruped'
  }

  protected override isHorizontalCapsule(): boolean {
    return false
  }

  protected override shouldInclineOnRamps(): boolean {
    return true
  }

  protected override getSlopeProbes(): { frontZ: number; rearZ: number; halfWidth: number } {
    return {
      frontZ: 1.1 * this.scale,
      rearZ: 1.1 * this.scale,
      halfWidth: 0.35 * this.scale
    }
  }

  protected override getRampSlopeConfig(): RampSlopeConfig {
    return {
      aheadOffset: 0.0,
      rayOriginHeight: 1.5,
      maxRayDistance: 4.0,
      minNormalY: 0.3,
      clampThreshold: 0.99,
      lerpSpeed: 12.0,
      airborneDecay: 2.0,
      pitchMultiplier: 1.0,
      rollMultiplier: 1.0,
    }
  }

  protected override createStandingColliderGeometry(): THREE.BufferGeometry {
    return new THREE.BoxGeometry(0.585, 1.47, 2.92)
  }

  protected override createCrouchingColliderGeometry(): THREE.BufferGeometry {
    return new THREE.BoxGeometry(0.585, 1.05, 2.10)
  }

  protected override getColliderCenterY(isCrouch: boolean): number {
    return isCrouch ? (1.05 / 2) : (1.47 / 2)
  }

  public override getFPVOffset(): THREE.Vector3 {
    return this.isCrouching()
      ? new THREE.Vector3(0, 0.75 * this.scale, 0.1 * this.scale)
      : new THREE.Vector3(0, 1.25 * this.scale, 0.1 * this.scale)
  }

  public getModelUrl(): string {
    return quadrupedCubesGlb
  }

  public getAnimationsUrl(): string {
    return quadrupedAnimsGlb
  }

  public getDefaultIdleAnim(): string {
    return 'Rest Pose'
  }

  public getDefaultWalkAnim(): string {
    return 'Walk'
  }

  public getDefaultSprintAnim(): string {
    return 'Run'
  }

  public getDefaultCrouchIdleAnim(): string {
    return 'Sit'
  }

  public getDefaultCrouchWalkAnim(): string {
    return 'Walk'
  }

  public getDefaultJumpAirAnim(): string {
    return 'Jump_air'
  }

  public getStandingCapsuleRadius(): number {
    return 0.45
  }

  public getStandingCapsuleHeight(): number {
    return 0.65
  }

  public getCrouchingCapsuleRadius(): number {
    return 0.45
  }

  public getCrouchingCapsuleHeight(): number {
    return 0.45
  }

  public getModelYOffset(): number {
    return 0.0
  }

  protected override getCustomActionAnimation(keysPressed: Record<string, boolean>): string | null {
    if (keysPressed['KeyB'] || keysPressed['Keyb'] || keysPressed['b'] || keysPressed['B']) {
      return 'Bark'
    }
    return null
  }
}
