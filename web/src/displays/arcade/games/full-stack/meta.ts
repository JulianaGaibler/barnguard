import { withAlpha } from '@src/stargazer'
import type { GameModule } from '../GameModule'
import FullStackGame from './FullStackGame.svelte'
import { COLORS } from './game/tuning'
import { FULL_STACK_FONT_TOKENS } from './fonts'
import thumbImage from './assets/thumb.png?url'

const INK = COLORS.ink

export const fullStackModule: GameModule = {
  meta: {
    id: 'full-stack',
    title: 'Full Stack',
    description:
      'Hire nine people into a 3x3 org from two shared shortlists. Every hire pays out once and scores at the end, so the org you build is the score you get.',
    playerCounts: [1, 2],
    supportsAi: true,
    thumbColor: '#eceae4',
    thumbImage,
    // The board's own light palette, seeded from `game/tuning.ts` so the chrome
    // and the board cannot drift apart. The full role set is overridden rather
    // than a subset: unset roles fall through to the arcade's pink chrome, which
    // would leave purple card shadows and a purple accent on the pale board.
    themeTokens: {
      surface: COLORS.board,
      surfaceCard: COLORS.panel,
      surfaceInverse: INK,
      scrim: withAlpha(INK, 0.6),
      text: INK,
      textSecondary: COLORS.inkSoft,
      textInverse: COLORS.panel,
      title: COLORS.activeSide,
      border: '#e0ddd3',
      accent: COLORS.activeSide,
      teamA: '#2f7d4f',
      teamB: COLORS.activeSide,
      actionPrimary: '#2f7d4f',
      actionPrimaryText: COLORS.panel,
      actionPrimaryHover: '#286c44',
      actionPrimaryActive: '#215a39',
      actionSecondary: '#eceae4',
      actionSecondaryText: INK,
      actionSecondaryHover: '#e0ddd3',
      actionSecondaryActive: '#d3cfc2',
      shadowCard: withAlpha(INK, 0.14),
      shadowPanel: withAlpha(INK, 0.2),
      gradientPlay: `linear-gradient(120deg, ${COLORS.backdropTop}, ${COLORS.backdropBottom})`,
      gradientResult: `linear-gradient(120deg, ${COLORS.panel}, ${COLORS.backdropBottom})`,
    },
    fontTokens: FULL_STACK_FONT_TOKENS,
  },
  component: FullStackGame,
}
