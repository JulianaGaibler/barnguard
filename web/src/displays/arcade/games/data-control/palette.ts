/**
 * Data Control's color seeds and the DOM theme derived from them. The canvas
 * layer reads the same seeds, so the map and the chrome around it stay the same
 * black, green and blue.
 *
 * Shades mix into `BLACK` instead of lying over it with alpha, because the
 * canvas cannot blend against the arcade sky behind it. `scrim` is the
 * exception: it covers the canvas rather than sitting inside it, so it carries
 * real alpha.
 */

import { mixColor, withAlpha } from '@src/stargazer'
import type { ThemePalette } from '@src/core/theme'

/** Backdrop black. The map paints on it, so shades mix against it. */
export const BLACK = '#050505'
/** Scrim black, lifted off {@link BLACK} so a modal reads against the map. */
export const SCRIM_BLACK = '#0f0f0f'
export const WHITE = '#FFFFFF'
/** Primary action and reference grid. */
export const GREEN = '#01CA05'
/** Map and destination accent. */
export const BLUE = '#031BC4'

/**
 * Chrome tokens for the shared menu, pause and game-over components, applied by
 * the arcade through `themeScope`.
 */
export const themeTokens: ThemePalette = {
  surface: BLACK,
  surfaceCard: mixColor(BLACK, WHITE, 0.07),
  surfaceInverse: WHITE,
  scrim: withAlpha(SCRIM_BLACK, 0.7),

  text: WHITE,
  textSecondary: mixColor(BLACK, WHITE, 0.62),
  textInverse: BLACK,
  title: WHITE,

  border: mixColor(BLACK, WHITE, 0.2),
  accent: GREEN,

  actionPrimary: GREEN,
  actionPrimaryText: BLACK,
  actionPrimaryHover: mixColor(GREEN, BLACK, 0.15),
  actionPrimaryActive: mixColor(GREEN, BLACK, 0.3),
  actionPrimaryDisabled: mixColor(GREEN, BLACK, 0.6),

  actionSecondary: WHITE,
  actionSecondaryText: WHITE,
  actionSecondaryHover: mixColor(BLACK, WHITE, 0.12),
  actionSecondaryActive: mixColor(BLACK, WHITE, 0.2),
  actionSecondaryDisabled: mixColor(BLACK, WHITE, 0.35),

  inputBg: mixColor(BLACK, WHITE, 0.1),
  shadowCard: `0 0.5rem 2rem ${BLACK}`,
  shadowPanel: `0 1rem 3rem ${BLACK}`,
}
