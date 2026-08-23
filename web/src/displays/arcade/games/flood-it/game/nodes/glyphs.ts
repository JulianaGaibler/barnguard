/**
 * The per-color shapes drawn inside cells and on the buttons.
 *
 * Six hues cannot be told apart by everyone, so each color carries a shape as
 * well. All six are drawn from primitives rather than a font or an SVG, so they
 * batch with the cells they sit on and stay crisp at any board size.
 */
import type { Gfx2D } from '@src/stargazer'
import { GEOM, type GlyphKind } from '../tuning'

/** Reused vertex scratch, so drawing a board of glyphs allocates nothing. */
const PTS = new Float32Array(8)

/**
 * Draw `kind` centered on `(cx, cy)`, sized to fit a `size` box.
 *
 * The caller sets the alpha, so a glyph can cross-fade with the cell under it.
 */
export function drawGlyph(
  gfx: Gfx2D,
  kind: GlyphKind,
  cx: number,
  cy: number,
  size: number,
  color: string,
): void {
  const r = size / 2
  switch (kind) {
    case 'circle':
      gfx.fillCircle(cx, cy, r, color)
      return

    case 'square':
      gfx.fillRoundRect(cx - r, cy - r, size, size, size * 0.16, color)
      return

    case 'triangle':
      PTS[0] = cx
      PTS[1] = cy - r
      PTS[2] = cx + r
      PTS[3] = cy + r * 0.78
      PTS[4] = cx - r
      PTS[5] = cy + r * 0.78
      gfx.fillConvexPoly(PTS, 3, color)
      return

    case 'diamond':
      PTS[0] = cx
      PTS[1] = cy - r
      PTS[2] = cx + r
      PTS[3] = cy
      PTS[4] = cx
      PTS[5] = cy + r
      PTS[6] = cx - r
      PTS[7] = cy
      gfx.fillConvexPoly(PTS, 4, color)
      return

    case 'chevron': {
      // Two strokes rather than a filled arrow, so it stays legible at the cell
      // sizes the large preset produces.
      const w = size * GEOM.glyphStrokeFrac
      PTS[0] = cx - r
      PTS[1] = cy - r * 0.35
      PTS[2] = cx
      PTS[3] = cy + r * 0.5
      PTS[4] = cx + r
      PTS[5] = cy - r * 0.35
      gfx.strokePolyline(PTS, 3, {
        color,
        width: w,
        cap: 'round',
        join: 'round',
      })
      return
    }

    case 'plus': {
      const arm = size * 0.3
      const half = arm / 2
      gfx.fillRoundRect(cx - r, cy - half, size, arm, half, color)
      gfx.fillRoundRect(cx - half, cy - r, arm, size, half, color)
      return
    }
  }
}
