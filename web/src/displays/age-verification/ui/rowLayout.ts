import type { Box } from './layout'

/** The side of an answer's square. */
export const TILE_SIZE = 128
/** Space between two answers. */
export const ROW_GAP = 63

/**
 * The top of each answer, for answers of these heights, stacked with a gap and
 * centered as a block in `box`. An answer is never shorter than its square. The
 * heights come from the browser, which wraps the text, so the stack follows
 * whatever the text needs.
 */
export function rowTops(
  heights: readonly number[],
  box: Box,
  gap: number = ROW_GAP,
): number[] {
  const rows = heights.map((height) => Math.max(height, TILE_SIZE))
  const total =
    rows.reduce((sum, height) => sum + height, 0) +
    gap * Math.max(rows.length - 1, 0)
  let top = box.y + (box.height - total) / 2
  return rows.map((height) => {
    const here = top
    top += height + gap
    return here
  })
}
