import type { GameModule } from '../GameModule'
import OrboGame from './OrboGame.svelte'
import thumbImage from './assets/thumb.png?url'
import { ORBO_FONT_TOKENS } from './fonts'

export const orboModule: GameModule = {
  meta: {
    id: 'orbo',
    title: 'Orbo',
    description:
      'Take turns flicking discs across into your zone, utilizing physics to knock opposing pieces out theirs. The player with the most discs inside their zone wins.',
    playerCounts: [2, 4],
    fontTokens: ORBO_FONT_TOKENS,
    thumbColor: '#DDDDDD',
    thumbImage,
  },
  component: OrboGame,
}
