import { FAMILIES, resolveFonts, type ThemeFonts } from '@src/core/theme'

/**
 * Data Control's typefaces: Azeret Mono throughout.
 *
 * The game is about routing data between states, and its chrome is already
 * instrumentation, so a fixed-width face for both roles makes it read as a
 * console rather than an app. Azeret Mono is variable, so headings can be set
 * heavy without a second file.
 */
export const DATA_CONTROL_FONT_TOKENS: ThemeFonts = {
  text: FAMILIES.azeretMono,
  heading: FAMILIES.azeretMono,
}

/** Resolved for `fontFor`, should the game grow canvas text. */
export const DATA_CONTROL_FONTS = resolveFonts(DATA_CONTROL_FONT_TOKENS)
