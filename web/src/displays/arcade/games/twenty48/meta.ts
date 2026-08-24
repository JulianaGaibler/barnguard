import { mixColor, withAlpha } from '@src/stargazer'
import type { ThemePalette } from '@src/core/theme'
import type { GameModule } from '../GameModule'
import Twenty48Game from './Twenty48Game.svelte'
import { ACCENT_SOLO, ACCENT_VS, COLORS, tileColor } from './game/tuning'
import { TWENTY48_FONT_TOKENS } from './fonts'
import thumbImage from './assets/thumb.png?url'
import { TWENTY48_LEADERBOARDS } from './leaderboards'

const INK = COLORS.ink

/**
 * The DOM chrome, seeded from the same constants the canvas reads so the two
 * cannot drift. Every role that matters is set deliberately: `applyPalette`
 * only ever sets and never removes, so a role left out here keeps the arcade
 * shell's value and would put the wrong accent on this game's cards.
 */
const themeTokens: ThemePalette = {
  surface: COLORS.background,
  surfaceCard: COLORS.background,
  surfaceInverse: COLORS.plate,
  scrim: withAlpha(INK, 0.4),

  text: INK,
  textSecondary: COLORS.inkSoft,
  textInverse: COLORS.inkLight,
  title: INK,

  border: withAlpha(INK, 0.18),
  accent: ACCENT_SOLO,
  teamA: ACCENT_VS[1],
  teamB: ACCENT_VS[2],

  actionPrimary: ACCENT_SOLO,
  actionPrimaryText: COLORS.inkLight,
  actionPrimaryHover: mixColor(ACCENT_SOLO, '#000000', 0.12),
  actionPrimaryActive: mixColor(ACCENT_SOLO, '#000000', 0.24),
  actionPrimaryDisabled: withAlpha(ACCENT_SOLO, 0.4),

  actionSecondary: INK,
  actionSecondaryText: INK,
  actionSecondaryHover: withAlpha(INK, 0.08),
  actionSecondaryActive: withAlpha(INK, 0.16),
  actionSecondaryDisabled: withAlpha(INK, 0.35),

  inputBg: COLORS.white,
  shadowCard: `0 0.5rem 2rem ${withAlpha(INK, 0.18)}`,
  shadowPanel: `0 1rem 3rem ${withAlpha(INK, 0.25)}`,
}

export const twenty48Module: GameModule = {
  meta: {
    // Permanent from the first submitted score: this is the leaderboard key,
    // the game-log `gameId` and the print-dispatch key.
    id: '2048',
    title: '2048',
    description: 'Join the numbers and get to the 2048 tile and beyond.',
    playerCounts: [1, 2],
    thumbColor: tileColor(2048),
    thumbImage,
    themeTokens,
    fontTokens: TWENTY48_FONT_TOKENS,
    leaderboards: TWENTY48_LEADERBOARDS,
  },
  component: Twenty48Game,
}
