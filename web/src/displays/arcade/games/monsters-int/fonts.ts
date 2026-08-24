import {
  FAMILIES,
  fontFor,
  resolveFonts,
  type ThemeFonts,
} from '@src/core/theme'

/**
 * Monsters, Int's typefaces: Bungee for headings, the brand text face for body.
 *
 * Bungee is a heavy signage face, which is what the reference art letters HIT
 * and STAY in, and it holds up at the sizes a table this size needs. It ships
 * one weight.
 */
export const MONSTERS_INT_FONT_TOKENS: ThemeFonts = {
  heading: FAMILIES.bungee,
  text: FAMILIES.mozillaText,
}

const MONSTERS_INT_FONTS = resolveFonts(MONSTERS_INT_FONT_TOKENS)

/** Labels and readouts on the canvas. */
export const font = (weight: number, size: number): string =>
  fontFor(MONSTERS_INT_FONTS, 'text', weight, size)

/** The button lettering, and anything else that shouts. */
export const displayFont = (size: number): string =>
  fontFor(MONSTERS_INT_FONTS, 'heading', 400, size)
