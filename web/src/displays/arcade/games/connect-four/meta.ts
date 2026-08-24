import { mixColor } from '@src/stargazer'
import type { GameModule } from '../GameModule'
import ConnectFourGame from './ConnectFourGame.svelte'
import thumbImage from './assets/thumb.png?url'
import { CONNECT_FOUR_FONT_TOKENS } from './fonts'
import { PLAYER_COLORS } from './game/tuning'

export const connectFourModule: GameModule = {
  meta: {
    id: 'connect-four',
    title: 'Connect Four',
    description:
      'Take turns dropping discs into a grid. The first to line up four in a row across, down, or diagonally wins.',
    playerCounts: [1, 2],
    supportsAi: true,
    thumbColor: '#DDDDDD',
    thumbImage,
    // Scoped to the game's DOM (splash / pause): purple vs green teams, a purple
    // primary action, and a green menu title. The two team colors are the same
    // constants the board draws discs with, so chrome and canvas cannot drift.
    themeTokens: {
      teamA: PLAYER_COLORS[1],
      teamB: PLAYER_COLORS[2],
      accent: PLAYER_COLORS[1],
      title: PLAYER_COLORS[2],
      actionPrimary: PLAYER_COLORS[1],
      actionPrimaryText: '#ffffff',
      actionPrimaryHover: mixColor(PLAYER_COLORS[1], '#000000', 0.12),
      actionPrimaryActive: mixColor(PLAYER_COLORS[1], '#000000', 0.24),
    },
    fontTokens: CONNECT_FOUR_FONT_TOKENS,
  },
  component: ConnectFourGame,
}
