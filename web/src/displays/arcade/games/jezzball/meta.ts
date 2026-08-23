import { withAlpha } from '@src/stargazer'
import type { ThemePalette } from '@src/core/theme'
import type { GameModule } from '../GameModule'
import JezzBallGame from './JezzBallGame.svelte'
import { ACCENT_SOLO, ACCENT_VS, COLORS } from './game/tuning'
import thumbImage from './assets/thumb.png?url'
import { JEZZBALL_FONT_TOKENS } from './fonts'

const INK = COLORS.ink
const PINK = ACCENT_SOLO.primary

/**
 * JezzBall's look: a light ground with a hard ink frame and a single pink
 * accent (purple/blue for the two players). Applied by the arcade via
 * `themeScope`, so the shared menu/pause/score components render in this
 * palette with no per-component overrides.
 *
 * The seeds come from `game/tuning.ts`, the same module the canvas reads, so
 * the chrome and the board cannot drift apart.
 */
const themeTokens: ThemePalette = {
  surface: COLORS.background,
  surfaceCard: COLORS.field,
  surfaceInverse: INK,
  scrim: withAlpha(INK, 0.35),

  text: INK,
  textSecondary: withAlpha(INK, 0.65),
  textInverse: COLORS.white,
  title: INK,

  border: withAlpha(INK, 0.18),
  accent: PINK,
  teamA: ACCENT_VS[1].primary,
  teamB: ACCENT_VS[2].primary,

  actionPrimary: PINK,
  actionPrimaryText: COLORS.white,
  actionPrimaryHover: ACCENT_SOLO.variant,
  // Hand-picked, not a mix of the hover variant.
  actionPrimaryActive: '#A50D45',
  actionPrimaryDisabled: withAlpha(PINK, 0.4),

  actionSecondary: INK,
  actionSecondaryText: INK,
  actionSecondaryHover: withAlpha(INK, 0.08),
  actionSecondaryActive: withAlpha(INK, 0.16),
  actionSecondaryDisabled: withAlpha(INK, 0.35),

  inputBg: COLORS.white,
  shadowCard: `0 0.5rem 2rem ${withAlpha(INK, 0.18)}`,
  shadowPanel: `0 1rem 3rem ${withAlpha(INK, 0.25)}`,
}

export const jezzballModule: GameModule = {
  meta: {
    id: 'jezzball',
    title: 'JezzBall',
    description:
      'Wall off the arena while dodging the bouncing balls. Trap empty space to claim it, reach 75% to clear the stage, and see how many stages you can survive.',
    playerCounts: [1, 2],
    thumbColor: '#DDDDDD',
    thumbImage,
    themeTokens,
    fontTokens: JEZZBALL_FONT_TOKENS,
    supportsLeaderboard: true,
  },
  component: JezzBallGame,
}
