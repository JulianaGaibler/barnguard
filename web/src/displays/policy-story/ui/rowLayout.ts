import type { Box } from './layout'

/** The side of an answer's square. */
export const TILE_SIZE = 56
/** Space between two answers. */
export const ROW_GAP = 28
/** The least space between two answers when the stack is too tall for its box. */
export const MIN_ROW_GAP = 16
/** Space between two answers that stand side by side. */
export const ANSWER_COLUMN_GAP = 96

/**
 * The left edge of each of `count` answers standing side by side in `box`, and
 * the width every one of them has, with `gap` between them.
 */
export function columnLayout(
  count: number,
  box: Box,
  gap: number = ANSWER_COLUMN_GAP,
): { xs: number[]; width: number } {
  const width = Math.max((box.width - gap * Math.max(count - 1, 0)) / count, 0)
  return {
    xs: Array.from({ length: count }, (_, i) => box.x + i * (width + gap)),
    width,
  }
}

/**
 * The left edge of each answer standing side by side, for answers of these
 * widths: a fixed `gap` between each and the next, and the whole row centered
 * in `box`.
 */
export function centerRow(
  widths: readonly number[],
  box: Box,
  gap: number = ANSWER_COLUMN_GAP,
): number[] {
  const total =
    widths.reduce((sum, width) => sum + width, 0) +
    gap * Math.max(widths.length - 1, 0)
  let x = box.x + (box.width - total) / 2
  return widths.map((width) => {
    const here = x
    x += width + gap
    return here
  })
}

/** The left edge of each answer of these widths, centered in `box` on its own. */
export function centerEach(widths: readonly number[], box: Box): number[] {
  return widths.map((width) => box.x + (box.width - width) / 2)
}

/**
 * The top of each answer standing side by side, for answers of these heights.
 * They share one top, which centers the tallest of them in `box`.
 */
export function columnTops(heights: readonly number[], box: Box): number[] {
  const tallest = Math.max(TILE_SIZE, ...heights)
  const top = box.y + (box.height - tallest) / 2
  return heights.map(() => top)
}

/**
 * The top of each answer, for answers of these heights, stacked with a gap and
 * centered as a block in `box`. An answer is never shorter than its square. The
 * heights come from the browser, which wraps the text, so the stack follows
 * whatever the text needs. A stack taller than `box` closes the gaps, down to
 * `MIN_ROW_GAP`.
 */
export function rowTops(
  heights: readonly number[],
  box: Box,
  gap: number = ROW_GAP,
): number[] {
  const rows = heights.map((height) => Math.max(height, TILE_SIZE))
  const heightSum = rows.reduce((sum, height) => sum + height, 0)
  const gaps = Math.max(rows.length - 1, 0)
  const fitted =
    gaps > 0 && heightSum + gap * gaps > box.height
      ? Math.max((box.height - heightSum) / gaps, MIN_ROW_GAP)
      : gap
  let top = box.y + (box.height - heightSum - fitted * gaps) / 2
  return rows.map((height) => {
    const here = top
    top += height + fitted
    return here
  })
}
