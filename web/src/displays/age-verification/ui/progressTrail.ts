/**
 * Geometry for the row of progress marks: one per screen shown, joined by short
 * lines, scaled down to fit once the row outgrows its width.
 */
import type { ProgressMark } from '../story/run'

/** Size of one mark, in design pixels. */
export const MARK_SIZE = 36
/** Length of the line between two marks. */
export const LINK_LENGTH = 16

export interface TrailGeometry {
  /** The row's natural width, the SVG's viewBox width. */
  naturalWidth: number
  /** The width it's drawn at, at most `maxWidth`. */
  width: number
  height: number
  /** Left edge of each mark in viewBox units. */
  marks: { x: number; mark: ProgressMark }[]
  /** Each link, from one mark's right edge to the next mark's left edge. */
  links: { x1: number; x2: number }[]
}

export function trailGeometry(
  marks: readonly ProgressMark[],
  maxWidth: number,
): TrailGeometry {
  const step = MARK_SIZE + LINK_LENGTH
  const naturalWidth = marks.length
    ? marks.length * MARK_SIZE + (marks.length - 1) * LINK_LENGTH
    : 0
  const scale = naturalWidth > maxWidth ? maxWidth / naturalWidth : 1
  return {
    naturalWidth,
    width: naturalWidth * scale,
    height: MARK_SIZE * scale,
    marks: marks.map((mark, i) => ({ x: i * step, mark })),
    links: marks.slice(1).map((_, i) => ({
      x1: i * step + MARK_SIZE,
      x2: (i + 1) * step,
    })),
  }
}

/** The distance from one mark's left edge to the next one's. */
export const MARK_STEP = MARK_SIZE + LINK_LENGTH

/**
 * Where the mark at `index` of a row of `count` sits, as its center and its
 * size, measured from the row's top left corner. The row scales down to fit
 * `maxWidth`, so the slot does too. A flying mark aims for the slot of a mark
 * that does not exist yet.
 */
export function markSlot(
  count: number,
  index: number,
  maxWidth: number,
): { x: number; y: number; size: number } {
  const natural = count > 0 ? count * MARK_SIZE + (count - 1) * LINK_LENGTH : 0
  const scale = natural > maxWidth && natural > 0 ? maxWidth / natural : 1
  return {
    x: (index * MARK_STEP + MARK_SIZE / 2) * scale,
    y: (MARK_SIZE / 2) * scale,
    size: MARK_SIZE * scale,
  }
}
