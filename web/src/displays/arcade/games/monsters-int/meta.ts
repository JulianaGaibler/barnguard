import { mixColor, withAlpha } from '@src/stargazer'
import type { ThemePalette } from '@src/core/theme'
import type { GameModule } from '../GameModule'
import MonstersIntGame from './MonstersIntGame.svelte'
import { MONSTERS_INT_FONT_TOKENS } from './fonts'
import { COLORS, SEATS } from './game'
import thumbImage from './assets/thumb.png?url'

const INK = COLORS.ink
const ACCENT = SEATS[0]!.color

/**
 * The DOM chrome, seeded from the same constants the table reads so the two
 * cannot drift. Every role that matters is set deliberately: `applyPalette`
 * only ever sets and never removes, so a role left out here keeps the arcade
 * shell's value and would put the wrong accent on this game's cards.
 */
const themeTokens: ThemePalette = {
  surface: COLORS.cream,
  surfaceCard: COLORS.cream,
  surfaceInverse: INK,
  scrim: withAlpha(INK, 0.45),

  text: INK,
  textSecondary: withAlpha(INK, 0.62),
  textInverse: COLORS.cream,
  title: INK,

  border: withAlpha(INK, 0.18),
  accent: ACCENT,
  teamA: SEATS[0]!.color,
  teamB: SEATS[1]!.color,

  actionPrimary: ACCENT,
  actionPrimaryText: COLORS.cream,
  actionPrimaryHover: mixColor(ACCENT, '#000000', 0.12),
  actionPrimaryActive: mixColor(ACCENT, '#000000', 0.24),
  actionPrimaryDisabled: withAlpha(ACCENT, 0.4),

  actionSecondary: INK,
  actionSecondaryText: INK,
  actionSecondaryHover: withAlpha(INK, 0.08),
  actionSecondaryActive: withAlpha(INK, 0.16),
  actionSecondaryDisabled: withAlpha(INK, 0.35),

  inputBg: COLORS.cream,
  shadowCard: `0 0.5rem 2rem ${withAlpha(INK, 0.18)}`,
  shadowPanel: `0 1rem 3rem ${withAlpha(INK, 0.25)}`,
}

export const monstersIntModule: GameModule = {
  meta: {
    id: 'monsters-int',
    title: 'Monsters, Int',
    description:
      'Take another card, or bank what you have. Collect the same number twice and the round eats you. First to 200 wins, and the monster is dealing.',
    playerCounts: [2, 3, 4, 5],
    thumbColor: COLORS.skin,
    thumbImage,
    themeTokens,
    fontTokens: MONSTERS_INT_FONT_TOKENS,
  },
  component: MonstersIntGame,
}
