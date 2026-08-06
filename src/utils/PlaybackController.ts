import type { MotionFrame } from '../types'
import type { BaseActor } from '../actors/BaseActor'

export class PlaybackController {
  private trajectory: MotionFrame[] = []
  private currentTime: number = 0
  private isPlaying: boolean = false
  private loop: boolean = true
  private maxDuration: number = 0

  public setTrajectory(jsonOrFrames: string | MotionFrame[]): void {
    if (!jsonOrFrames) {
      this.trajectory = []
      this.maxDuration = 0
      return
    }

    if (Array.isArray(jsonOrFrames)) {
      this.trajectory = jsonOrFrames
    } else {
      try {
        const parsed = JSON.parse(jsonOrFrames)
        if (Array.isArray(parsed)) {
          this.trajectory = parsed
        } else if (typeof parsed === 'object' && parsed !== null) {
          if (Array.isArray(parsed.trajectory)) {
            this.trajectory = parsed.trajectory
          } else if (Array.isArray(parsed.motion_data)) {
            this.trajectory = parsed.motion_data
          } else if (typeof parsed.motion_data === 'string' && parsed.motion_data.trim()) {
            this.trajectory = JSON.parse(parsed.motion_data)
          } else {
            this.trajectory = []
          }
        }
      } catch {
        this.trajectory = []
      }
    }

    if (Array.isArray(this.trajectory) && this.trajectory.length > 0) {
      this.trajectory.sort((a, b) => a.t - b.t)
      this.maxDuration = this.trajectory[this.trajectory.length - 1].t || 0
    } else {
      this.trajectory = []
      this.maxDuration = 0
    }
  }

  public getTrajectory(): MotionFrame[] {
    return this.trajectory
  }

  public getMaxDuration(): number {
    return this.maxDuration
  }

  public getCurrentTime(): number {
    return this.currentTime
  }

  public setCurrentTime(t: number): void {
    this.currentTime = Math.max(0, Math.min(t, this.maxDuration))
  }

  public start(): void {
    if (this.trajectory.length > 0) {
      this.isPlaying = true
      this.currentTime = 0
    }
  }

  public play(): void {
    if (this.trajectory.length > 0) {
      this.isPlaying = true
    }
  }

  public pause(): void {
    this.isPlaying = false
  }

  public stop(): void {
    this.isPlaying = false
    this.currentTime = 0
  }

  public getIsPlaying(): boolean {
    return this.isPlaying
  }

  public setLoop(loop: boolean): void {
    this.loop = loop
  }

  public update(dt: number, actor: BaseActor | null): void {
    if (!actor || this.trajectory.length === 0) return

    if (this.isPlaying) {
      this.currentTime += dt
      if (this.currentTime >= this.maxDuration) {
        if (this.loop) {
          this.currentTime = this.currentTime % Math.max(0.001, this.maxDuration)
        } else {
          this.currentTime = this.maxDuration
          this.isPlaying = false
        }
      }
    }

    const frameDt = this.isPlaying ? dt : 0
    this.evaluateAt(this.currentTime, actor, frameDt)
  }

  public evaluateAt(t: number, actor: BaseActor, dt: number = 0.016): void {
    if (this.trajectory.length === 0 || !actor) return

    if (this.trajectory.length === 1) {
      actor.applyMotionFrame(this.trajectory[0], 0, dt)
      return
    }

    let idxA = 0
    for (let i = 0; i < this.trajectory.length; i++) {
      if (this.trajectory[i].t <= t) idxA = i
      else break
    }

    // Clamp idxB to avoid wrapping back to frame 0 at the end of the route
    const idxB = Math.min(idxA + 1, this.trajectory.length - 1)
    const frameA = this.trajectory[idxA]
    const frameB = this.trajectory[idxB]

    const timeDiff = frameB.t - frameA.t
    const factor = (timeDiff > 0 && idxB > idxA) ? Math.min(1, Math.max(0, (t - frameA.t) / timeDiff)) : 0

    const px = frameA.px + (frameB.px - frameA.px) * factor
    const py = frameA.py + (frameB.py - frameA.py) * factor
    const pz = frameA.pz + (frameB.pz - frameA.pz) * factor

    let diffX = ((frameB as any).rx ?? 0) - ((frameA as any).rx ?? 0)
    diffX = Math.atan2(Math.sin(diffX), Math.cos(diffX))
    const rx = ((frameA as any).rx ?? 0) + diffX * factor

    let diffY = frameB.ry - frameA.ry
    diffY = Math.atan2(Math.sin(diffY), Math.cos(diffY))
    const ry = frameA.ry + diffY * factor

    let diffZ = ((frameB as any).rz ?? 0) - ((frameA as any).rz ?? 0)
    diffZ = Math.atan2(Math.sin(diffZ), Math.cos(diffZ))
    const rz = ((frameA as any).rz ?? 0) + diffZ * factor

    const dtSample = Math.max(0.005, timeDiff)
    const angularVel = diffY / dtSample

    if (typeof (actor as any).applyMotionFrame === 'function') {
      (actor as any).applyMotionFrame({
        t, px, py, pz, rx, ry, rz, anim: frameA.anim
      }, angularVel, dt)
    } else if (typeof actor.setPosition === 'function') {
      actor.setPosition(px, py, pz, ry)
    }
  }
}
