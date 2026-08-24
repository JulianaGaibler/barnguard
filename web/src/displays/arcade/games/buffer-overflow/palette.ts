/**
 * The DOM chrome, seeded from the same constants the canvas reads so the two
 * cannot drift.
 *
 * Every role that matters is set deliberately. `applyPalette` only ever sets
 * and never removes, so a role left out here keeps the arcade shell's value and
 * would put the wrong accent on this game's cards.
 *
 * The accent is fixed, unlike the canvas one. `themeTokens` is a static object
 * applied once when the game mounts, so a running level has no way to reach it.
 * Taking a point from the middle of the same ramp keeps the menu and the pause
 * card in the family without pretending to be live.
 */
import { mixColor, withAlpha } from '@src/stargazer'
import type { ThemePalette } from '@src/core/theme'
import { ACCENT_CHROME, COLORS } from './game/tuning'

const INK = COLORS.ink

/**
 * The primary button's fill, lifted off the accent.
 *
 * The accent itself is a mid-tone violet, and dark label text on it lands just
 * under the readable threshold. A button fill has a different job from an
 * accent line, so it takes a lighter step of the same hue and the line keeps
 * the true ramp color.
 */
const PRIMARY_FILL = mixColor(ACCENT_CHROME, '#FFFFFF', 0.18)

export const BUFFER_OVERFLOW_PALETTE: ThemePalette = {
  surface: COLORS.backdropBottom,
  surfaceCard: COLORS.pane,
  surfaceInverse: COLORS.ink,
  scrim: withAlpha(COLORS.backdropBottom, 0.72),

  text: INK,
  textSecondary: COLORS.inkSoft,
  textAccent: ACCENT_CHROME,
  textInverse: COLORS.inkDark,
  title: INK,

  border: COLORS.rule,
  accent: ACCENT_CHROME,
  teamA: '#4C6FE0',
  teamB: '#E86A2C',

  actionPrimary: PRIMARY_FILL,
  actionPrimaryText: COLORS.inkDark,
  actionPrimaryHover: mixColor(PRIMARY_FILL, '#FFFFFF', 0.12),
  actionPrimaryActive: mixColor(PRIMARY_FILL, '#000000', 0.14),
  actionPrimaryDisabled: withAlpha(PRIMARY_FILL, 0.4),

  actionSecondary: withAlpha(INK, 0.1),
  actionSecondaryText: INK,
  actionSecondaryHover: withAlpha(INK, 0.18),
  actionSecondaryActive: withAlpha(INK, 0.26),
  actionSecondaryDisabled: withAlpha(INK, 0.3),

  inputBg: COLORS.backdropTop,
  // A terminal has rules, not drop shadows. Both roles carry a hairline
  // instead of a blur, so a card reads as a framed pane like the canvas ones.
  shadowCard: `0 0 0 1px ${COLORS.rule}`,
  shadowPanel: `0 0 0 1px ${COLORS.rule}`,
  appBackdrop: COLORS.backdropBottom,
}
