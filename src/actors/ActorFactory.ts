import { BaseActor } from './BaseActor'
import { HumanActor } from './HumanActor'
import { CarActor } from './CarActor'

export class ActorFactory {
  public static create(type?: 'human' | 'car' | string): BaseActor {
    if (type === 'car') {
      return new CarActor()
    }
    return new HumanActor()
  }
}
