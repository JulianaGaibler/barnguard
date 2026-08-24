import { FAMILIES, fontWith, type ThemeFonts } from '@src/core/theme'

/**
 * Buffer Overflow is set entirely in Azeret Mono.
 *
 * One fixed-width face for both roles is what makes the game read as a terminal
 * application rather than as an app, which is the same reasoning Data Control
 * gives for the same choice. It also makes the layout honest: a TUI is built on
 * a character grid, and a proportional face would only pretend to be.
 *
 * With one family, hierarchy is carried by weight and color instead. The rule
 * is that chrome recedes and data pops: rules and captions sit at 400 in
 * `inkSoft`, values and key caps at 700 in `ink` or the level accent.
 *
 * @remarks
 *   Azeret Mono is a variable face across `100 900`, so any weight in that range
 *   is a real cut rather than a synthesised one.
 */
export const BUFFER_OVERFLOW_FONT_TOKENS: ThemeFonts = {
  heading: FAMILIES.azeretMono,
  text: FAMILIES.azeretMono,
}

/**
 * Every label the canvas draws.
 *
 * Named directly rather than through a theme role, because there is only one
 * face and a role indirection would suggest a choice that is not being made.
 * `fontWith` quantizes the size, which matters here: the size is part of the
 * label cache key, and a raw layout fraction would drift every frame and miss
 * the cache on every draw.
 */
export const font = (weight: number, size: number): string =>
  fontWith(FAMILIES.azeretMono, weight, size)
