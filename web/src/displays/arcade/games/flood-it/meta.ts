import type { GameModule } from '../GameModule'
import FloodItGame from './FloodItGame.svelte'
import { FLOOD_IT_FONT_TOKENS } from './fonts'
import { FLOOD_IT_PALETTE } from './palette'
import thumbImage from './assets/thumb.png?url'

export const floodItModule: GameModule = {
  meta: {
    id: 'flood-it',
    title: 'Flood It',
    description:
      'Own the corner, pick a color, and watch your region swallow everything that matches. Turn the whole board one color before your moves run out, or take the board off someone else a cell at a time.',
    playerCounts: [1, 2],
    thumbColor: '#1B2340',
    themeTokens: FLOOD_IT_PALETTE,
    fontTokens: FLOOD_IT_FONT_TOKENS,
    thumbImage,
  },
  component: FloodItGame,
}
