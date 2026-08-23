import {
  FAMILIES,
  fontFor,
  resolveFonts,
  type ThemeFonts,
} from '@src/core/theme'

/**
 * Full Stack's typefaces: Sorts Mill Goudy for headings, HK Grotesk for body.
 *
 * An old-style serif over a clean grotesque reads as letterhead, which is the
 * register a game about corporate busywork wants.
 *
 * The serif is chrome only. Nothing on the board is set in it: a card is nine
 * short strings in a space a few hundred pixels across, and at that size the
 * serif costs legibility for a register the surrounding chrome already sets.
 */
export const FULL_STACK_FONT_TOKENS: ThemeFonts = {
  heading: FAMILIES.sortsMillGoudy,
  text: FAMILIES.hkGrotesk,
}

const FONTS = resolveFonts(FULL_STACK_FONT_TOKENS)

/**
 * The body font at a weight and size, for canvas nodes.
 *
 * Was a `font()` helper copy-pasted into three node modules, each naming the
 * stack inline. Callers ask for weights 500/600/700/800; HK Grotesk ships
 * 400/500/700, so `fontFor` snaps the ones it does not have rather than letting
 * the browser synthesise them.
 */
/**
 * The body family on its own, for the nodes that take a family and a size
 * separately rather than a CSS shorthand.
 */
export const textFamily = FAMILIES.hkGrotesk

export const font = (weight: number, size: number): string =>
  fontFor(FONTS, 'text', weight, Math.max(1, size))
