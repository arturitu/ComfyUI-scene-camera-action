import { BaseActor } from './BaseActor'
import { HumanActor } from './HumanActor'
import { CarActor } from './CarActor'
import { QuadrupedActor } from './QuadrupedActor'

export class ActorFactory {
  public static create(type?: 'human' | 'car' | 'quadruped' | string): BaseActor {
    if (type === 'car') {
      return new CarActor()
    }
    if (type === 'quadruped') {
      return new QuadrupedActor()
    }
    return new HumanActor()
  }
}
