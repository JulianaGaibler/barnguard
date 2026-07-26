import type { GameModule } from '../GameModule'
import ConnectFourGame from './ConnectFourGame.svelte'
import thumbImage from './assets/thumb.png?url'

export const connectFourModule: GameModule = {
  meta: {
    id: 'connect-four',
    title: 'Connect Four',
    description:
      'Take turns dropping discs into a grid. The first to line up four in a row across, down, or diagonally wins.',
    players: '1-2',
    thumbColor: '#DDDDDD',
    thumbImage,
    // Scoped to the game's DOM (splash / pause): purple vs green teams, a purple
    // primary action, and a green menu title.
    themeTokens: {
      teamA: '#8F74E7',
      teamB: '#41AB8E',
      accent: '#8F74E7',
      title: '#41AB8E',
      actionPrimary: '#8F74E7',
      actionPrimaryText: '#ffffff',
      actionPrimaryHover: '#7d61d8',
      actionPrimaryActive: '#6b50c4',
    },
  },
  component: ConnectFourGame,
}
