import type { GameModule } from '../GameModule'
import BufferOverflowGame from './BufferOverflowGame.svelte'
import { BUFFER_OVERFLOW_FONT_TOKENS } from './fonts'
import { BUFFER_OVERFLOW_LEADERBOARDS } from './leaderboards'
import { BUFFER_OVERFLOW_PALETTE } from './palette'
import { BUFFER_OVERFLOW_STRINGS as t } from './strings'
import { COLORS } from './game/tuning'
import thumbImage from './assets/thumb.png?url'

export const bufferOverflowModule: GameModule = {
  meta: {
    // Permanent from the first submitted score: this is the leaderboard key,
    // the game-log `gameId` and the print-dispatch key.
    id: 'buffer-overflow',
    title: t.title,
    description:
      'Steer falling blocks into the buffer and fill a row to clear it. Four at once is a flush. Play Uptime until the buffer overflows, or Countdown against a clock that only your clears can refill.',
    playerCounts: [1, 2],
    thumbColor: COLORS.backdropTop,
    thumbImage,
    themeTokens: BUFFER_OVERFLOW_PALETTE,
    fontTokens: BUFFER_OVERFLOW_FONT_TOKENS,
    leaderboards: BUFFER_OVERFLOW_LEADERBOARDS,
  },
  component: BufferOverflowGame,
}
