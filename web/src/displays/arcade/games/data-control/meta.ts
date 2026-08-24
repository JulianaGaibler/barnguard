import type { GameModule } from '../GameModule'
import DataControlGame from './DataControlGame.svelte'
import thumbImage from './assets/thumb.png?url'
import { BLACK, themeTokens } from './palette'
import { DATA_CONTROL_FONT_TOKENS } from './fonts'
import { DATA_CONTROL_LEADERBOARDS } from './leaderboards'

export const dataControlModule: GameModule = {
  meta: {
    id: 'data-control',
    title: 'Data Control',
    description:
      'Route incoming data packets safely into their target zone. Never let two collide or one slip past the border.',
    playerCounts: [1],
    thumbColor: BLACK,
    thumbImage,
    themeTokens,
    fontTokens: DATA_CONTROL_FONT_TOKENS,
    leaderboards: DATA_CONTROL_LEADERBOARDS,
  },
  component: DataControlGame,
}
