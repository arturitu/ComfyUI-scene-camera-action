import * as THREE from 'three'
import { SkinnedActor } from './SkinnedActor'

import humanCubesGlb from '../assets/models/human-cubes-rigged.glb'
import humanAnimsGlb from '../assets/models/human-animations.glb'

export class HumanActor extends SkinnedActor {
  constructor() {
    super()
    this.buildMesh()
  }

  public getType(): 'human' {
    return 'human'
  }

  protected override isHoldToCrouch(): boolean {
    return true
  }

  public override getFPVOffset(): THREE.Vector3 {
    return this.isCrouching()
      ? new THREE.Vector3(0, 0.85 * this.scale, 0.1 * this.scale)
      : new THREE.Vector3(0, 1.65 * this.scale, 0.1 * this.scale)
  }

  public getModelUrl(): string {
    return humanCubesGlb
  }

  public getAnimationsUrl(): string {
    return humanAnimsGlb
  }

  public getDefaultIdleAnim(): string {
    return 'Idle_A'
  }

  public getDefaultWalkAnim(): string {
    return 'Walk'
  }

  public getDefaultSprintAnim(): string {
    return 'Sprint'
  }

  public getDefaultCrouchIdleAnim(): string {
    return 'Crouch_Idle'
  }

  public getDefaultCrouchWalkAnim(): string {
    return 'Crouch_Walk'
  }

  public getDefaultJumpAirAnim(): string {
    return 'Jump_air'
  }

  public getStandingCapsuleRadius(): number {
    return 0.35
  }

  public getStandingCapsuleHeight(): number {
    return 1.09
  }

  public getCrouchingCapsuleRadius(): number {
    return 0.35
  }

  public getCrouchingCapsuleHeight(): number {
    return 0.60
  }

  public getModelYOffset(): number {
    return 0.0
  }
}
