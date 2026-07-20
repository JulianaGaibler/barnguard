import type { GameModule } from '../GameModule'
import ConnectFourGame from './ConnectFourGame.svelte'

export const connectFourModule: GameModule = {
  meta: {
    id: 'connect-four',
    title: 'Connect Four',
    description:
      'Take turns dropping discs into a seven-by-six grid; the first to line up four in a row across, down, or diagonally wins. Play a friend, or take on the computer at three strengths.',
    players: '1-2',
    thumbColor: '#4A90E2',
  },
  component: ConnectFourGame,
}
