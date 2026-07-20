import type { GameModule } from '../GameModule'
import OrboGame from './OrboGame.svelte'

export const orboModule: GameModule = {
  meta: {
    id: 'orbo',
    title: 'Orbo',
    description:
      'Take turns flicking circular discs across a divided screen to land them inside their zone, utilizing physics to knock opposing pieces out of position. When all players run out of discs, the player with the most discs inside their zone wins.',
    players: '2-4',
    thumbColor: '#05070d',
  },
  component: OrboGame,
}
