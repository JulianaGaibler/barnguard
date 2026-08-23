import {
  FAMILIES,
  fontFor,
  resolveFonts,
  type ThemeFonts,
} from '@src/core/theme'

/**
 * 2048's typefaces: Mozilla Headline Extended for the numerals, Geist for
 * everything else.
 *
 * The tile numerals are the game's whole identity, and an extended face fills a
 * square cell in a way a normal-width one does not: a `1024` still reads as a
 * display digit rather than as four cramped ones. Geist carries the score
 * readouts and the small copy, where an extended face would be shouting.
 */
export const TWENTY48_FONT_TOKENS: ThemeFonts = {
  heading: FAMILIES.mozillaHeadlineExtended,
  text: FAMILIES.geist,
}

/** Resolved for `fontFor` inside the game's scene nodes. */
export const TWENTY48_FONTS = resolveFonts(TWENTY48_FONT_TOKENS)

/** Score readouts, labels and the small HUD copy. */
export const font = (weight: number, size: number): string =>
  fontFor(TWENTY48_FONTS, 'text', weight, size)

/**
 * The tile numerals and the display moments.
 *
 * Mozilla Headline Extended ships weight 700 only, so `fontFor` snaps anything
 * heavier down to it rather than letting the browser synthesise a fake bold.
 */
export const headingFont = (weight: number, size: number): string =>
  fontFor(TWENTY48_FONTS, 'heading', weight, size)
