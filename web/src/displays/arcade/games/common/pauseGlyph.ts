/**
 * The arcade's pause mark: two rounded bars.
 *
 * Shared because every game wants the same symbol and the alternative each
 * reached for was the literal text `II`, which sits on the game's own heading
 * face and so reads at a different weight, width and optical size in every
 * game. Two drawn bars are identical everywhere and cost one instanced draw
 * each rather than a rasterized label with a cache entry.
 *
 * Only the mark. The button around it is the game's own, so a slab, a pill or a
 * bare tap target all keep their look.
 *
 * @example
 *   drawPauseGlyph(gfx, size / 2, size / 2, size, COLORS.ink)
 */
import type { Gfx2D } from '@src/stargazer'

/** Bar width, as a fraction of the glyph box. */
const BAR_W = 0.11
/** Bar height, same basis. */
const BAR_H = 0.36
/** Gap between the bars, same basis. */
const GAP = 0.1
/** Bar corner radius, as a fraction of the bar's own width. */
const RADIUS = 0.4

/** Draw the pause mark centred on `(cx, cy)`, sized to fit a `size` box. */
export function drawPauseGlyph(
  gfx: Gfx2D,
  cx: number,
  cy: number,
  size: number,
  color: string,
): void {
  const barW = size * BAR_W
  const barH = size * BAR_H
  const gap = size * GAP
  const radius = barW * RADIUS
  const top = cy - barH / 2
  gfx.fillRoundRect(cx - gap / 2 - barW, top, barW, barH, radius, color)
  gfx.fillRoundRect(cx + gap / 2, top, barW, barH, radius, color)
}
