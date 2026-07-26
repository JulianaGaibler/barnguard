import type { GameModule } from './GameModule'
import { orboModule } from './orbo/meta'
import { connectFourModule } from './connect-four/meta'
import { jezzballModule } from './jezzball/meta'

/** Games shown in the launcher. */
export const GAMES: GameModule[] = [
  orboModule,
  connectFourModule,
  jezzballModule,
]
