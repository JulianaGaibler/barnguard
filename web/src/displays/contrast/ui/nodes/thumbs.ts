/** The thumbs that stand for a level: one down, one up, or two up. */
import type { Canvas } from 'stargazer'
import type { Level } from '../../game/contrast'
import { PALETTE } from '../../theme'
import { drawGlyph, thumbGlyph } from '../icons'

/** The color a level is shown in once its answer is known. */
export const LEVEL_COLORS: Record<Level, string> = {
  1: PALETTE.red,
  2: PALETTE.yellow,
  3: PALETTE.green,
}

/** Space between two thumbs, as a share of the thumb's size. */
const GAP = 8 / 60

/** How many thumbs a level has. */
export function thumbCount(level: Level): number {
  return level === 3 ? 2 : 1
}

/** The width the thumbs of `level` take at `size`. */
export function thumbsWidth(level: Level, size: number): number {
  const count = thumbCount(level)
  return count * size + (count - 1) * size * GAP
}

/**
 * Draws the thumbs of `level` centered on `(cx, cy)`. The level 1 thumb points
 * down. The thumbs cross-fade from `from` to `to` as `mix` goes 0 to 1: `to` is
 * drawn solid and `from` over it, so nothing blends twice.
 */
export function drawThumbs(
  canvas: Canvas,
  level: Level,
  cx: number,
  cy: number,
  size: number,
  from: string,
  to: string,
  mix = 0,
): void {
  const glyph = thumbGlyph()
  const count = thumbCount(level)
  const left = cx - thumbsWidth(level, size) / 2
  const y = cy - size / 2
  const paint = (color: string): void => {
    for (let i = 0; i < count; i++) {
      drawGlyph(
        canvas,
        glyph,
        left + i * size * (1 + GAP),
        y,
        size,
        color,
        level === 1,
      )
    }
  }
  if (mix >= 1) {
    paint(to)
    return
  }
  if (mix > 0) paint(to)
  canvas.setAlpha(1 - mix)
  paint(from)
  canvas.setAlpha(1)
}
