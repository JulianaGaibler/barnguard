import {
  FAMILIES,
  fontFor,
  resolveFonts,
  type ThemeFonts,
} from '@src/core/theme'

/**
 * JezzBall's typefaces: Bungee for headings, the brand text face for body.
 *
 * Bungee is a signage face: heavy, upright and legible well below poster size.
 * It carries the two display moments — the countdown and the waiting headline.
 * Scores and meta copy stay on Mozilla Text; a score at 58px is a readout
 * rather than a headline and reads better in the body face.
 */
export const JEZZBALL_FONT_TOKENS: ThemeFonts = {
  heading: FAMILIES.bungee,
  text: FAMILIES.mozillaText,
}

/** Resolved for `fontFor` inside the game's scene nodes. */
export const JEZZBALL_FONTS = resolveFonts(JEZZBALL_FONT_TOKENS)

/**
 * The HUD's small copy: pause label, meta lines, sublabels.
 *
 * Replaces a `FONT_FAMILY` constant that was redeclared in seven node modules.
 * Note that callers ask for weights up to 900 and Mozilla Text ships 400/500/
 * 700, so `fontFor` snaps them — the HUD reads a little lighter than it did on
 * a variable face.
 */
export const font = (weight: number, size: number): string =>
  fontFor(JEZZBALL_FONTS, 'text', weight, size)

/** The two display moments: the countdown and the waiting headline. */
export const headingFont = (weight: number, size: number): string =>
  fontFor(JEZZBALL_FONTS, 'heading', weight, size)
