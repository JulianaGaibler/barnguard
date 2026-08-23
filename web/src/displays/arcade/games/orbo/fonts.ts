import { FAMILIES, resolveFonts, type ThemeFonts } from '@src/core/theme'

/**
 * Orbo's typefaces: Geist throughout.
 *
 * Variable across the full weight axis, so the scoring count gets the heavy cut
 * it asks for rather than a snapped approximation.
 */
export const ORBO_FONT_TOKENS: ThemeFonts = {
  text: FAMILIES.geist,
  heading: FAMILIES.geist,
}

/** Resolved for `fontFor` inside the game's scene nodes. */
export const ORBO_FONTS = resolveFonts(ORBO_FONT_TOKENS)
