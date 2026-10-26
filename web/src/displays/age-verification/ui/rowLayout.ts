import type { Box } from './layout'

/** The side of an answer's square. */
export const TILE_SIZE = 56
/** Space between two answers. */
export const ROW_GAP = 28
/** The least space between two answers when the stack is too tall for its box. */
export const MIN_ROW_GAP = 16

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
