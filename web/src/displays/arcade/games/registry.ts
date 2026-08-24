import type { GameModule } from './GameModule'
import { orboModule } from './orbo/meta'
import { connectFourModule } from './connect-four/meta'
import { jezzballModule } from './jezzball/meta'
import { dataControlModule } from './data-control/meta'
import { fullStackModule } from './full-stack/meta'
import { twenty48Module } from './twenty48/meta'
import { floodItModule } from './flood-it/meta'
import { bufferOverflowModule } from './buffer-overflow/meta'
import { monstersIntModule } from './monsters-int/meta'

/** Games shown in the launcher. */
export const GAMES: GameModule[] = [
  floodItModule,
  connectFourModule,
  dataControlModule,
  monstersIntModule,
  jezzballModule,
  orboModule,
  bufferOverflowModule,
  twenty48Module,
  fullStackModule,
]
