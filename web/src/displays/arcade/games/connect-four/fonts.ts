import { FAMILIES, resolveFonts, type ThemeFonts } from '@src/core/theme'

/**
 * Connect Four's typefaces: Raleway throughout.
 *
 * The board's technical readouts stay on Azeret Mono, named directly rather
 * than through a role — corner version strings and turn status are meant to
 * read as fixed-width instrumentation, not as body copy.
 */
export const CONNECT_FOUR_FONT_TOKENS: ThemeFonts = {
  text: FAMILIES.raleway,
  heading: FAMILIES.raleway,
}

/** Resolved for `fontFor` inside the game's scene nodes. */
export const CONNECT_FOUR_FONTS = resolveFonts(CONNECT_FOUR_FONT_TOKENS)
