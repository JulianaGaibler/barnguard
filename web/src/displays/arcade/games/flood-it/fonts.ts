import {
  FAMILIES,
  fontFor,
  fontWith,
  resolveFonts,
  type ThemeFonts,
} from '@src/core/theme'

/**
 * Flood It's typefaces: Sniglet for headings, the brand text face for body.
 *
 * Sniglet is round and soft, which reads as a puzzle rather than an arcade
 * cabinet and keeps the game distinct from its neighbours on the launcher. It
 * ships one weight only.
 *
 * The heading role is used by the DOM overlays through `fontScope`, which is
 * where every heading in this game lives. Nothing on the canvas draws in it:
 * the board's readouts are numerals and status lines, and a display face set at
 * those sizes shouts.
 */
export const FLOOD_IT_FONT_TOKENS: ThemeFonts = {
  heading: FAMILIES.sniglet,
  text: FAMILIES.mozillaText,
}

/** Resolved once for the helpers below. */
const FLOOD_IT_FONTS = resolveFonts(FLOOD_IT_FONT_TOKENS)

/** Labels, captions and counts. */
export const font = (weight: number, size: number): string =>
  fontFor(FLOOD_IT_FONTS, 'text', weight, size)

/**
 * The move counter and the cell tallies.
 *
 * Named directly rather than through a role: these are readouts that change
 * every move, and tabular figures keep the digits from shifting under each
 * other as they do.
 */
export const numberFont = (weight: number, size: number): string =>
  fontWith(FAMILIES.azeretMono, weight, size)
