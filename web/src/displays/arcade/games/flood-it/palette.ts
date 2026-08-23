/**
 * Flood It's chrome palette.
 *
 * The board already carries six saturated colors, so the chrome stays dark and
 * quiet and lets them be the only bright thing on screen. That also separates
 * the game from its neighbours on the launcher, which run light.
 *
 * Every value is derived from the same constants in `game/tuning.ts` that the
 * canvas reads, because the canvas sits outside the scoped container and cannot
 * read the custom properties back. One source, both surfaces, no drift.
 *
 * Near every role is set rather than a chosen few: `applyPalette` only ever
 * writes, so a role left out keeps the arcade shell's own value and would put
 * the launcher's light card shadow on this game's dark panels.
 */
import { withAlpha } from '@src/stargazer'
import type { ThemePalette } from '@src/core/theme'
import { ACCENT, COLORS } from './game/tuning'

const INK = COLORS.ink
const PAPER = COLORS.paper
const TEAL = ACCENT[1]
const PINK = ACCENT[2]

/** Panel background, a step up from the backdrop so cards lift off it. */
const CARD = '#1C2440'

export const FLOOD_IT_PALETTE: ThemePalette = {
  surface: COLORS.backdropBottom,
  surfaceCard: CARD,
  surfaceInverse: INK,
  scrim: withAlpha(INK, 0.66),

  text: PAPER,
  textSecondary: withAlpha(PAPER, 0.66),
  textAccent: TEAL,
  textLink: TEAL,
  textInverse: PAPER,
  title: '#FFFFFF',

  border: withAlpha(PAPER, 0.14),
  accent: TEAL,
  teamA: TEAL,
  teamB: PINK,

  actionPrimary: TEAL,
  actionPrimaryText: INK,
  actionPrimaryHover: '#5BE3D3',
  // Hand-picked rather than a mix, so the pressed state darkens instead of
  // washing out on a dark panel.
  actionPrimaryActive: '#1FAF9E',
  actionPrimaryDisabled: withAlpha(TEAL, 0.35),

  actionSecondary: 'transparent',
  actionSecondaryText: PAPER,
  actionSecondaryHover: withAlpha(PAPER, 0.1),
  actionSecondaryActive: withAlpha(PAPER, 0.18),
  actionSecondaryDisabled: withAlpha(PAPER, 0.3),

  inputBg: withAlpha(PAPER, 0.08),
  shadowCard: `0 0.5rem 2rem ${withAlpha(INK, 0.5)}`,
  shadowPanel: `0 1rem 3rem ${withAlpha(INK, 0.6)}`,

  gradientPlay: TEAL,
  gradientResult: PINK,
}
