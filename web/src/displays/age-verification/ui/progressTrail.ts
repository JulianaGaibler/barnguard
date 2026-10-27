/**
 * Geometry for the row of progress marks: one per screen shown, joined by short
 * lines, the last five in view, scaled down to fit if even those outgrow the
 * width.
 */
import type { ProgressMark } from '../story/run'

/** Size of one mark, in design pixels. */
export const MARK_SIZE = 36
/** Length of the line between two marks. */
export const LINK_LENGTH = 16
/** The most marks the row shows. The oldest slide off as new ones arrive. */
export const MAX_MARKS = 5

/** How many of the oldest marks of a row of `count` are off the left end. */
export function hiddenMarks(count: number): number {
  return Math.max(0, count - MAX_MARKS)
}

export interface TrailGeometry {
  /** The natural width of the marks in view. */
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
  const shown = Math.min(marks.length, MAX_MARKS)
  const naturalWidth = shown ? shown * MARK_SIZE + (shown - 1) * LINK_LENGTH : 0
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
 * size, measured from the row's top left corner, once the row has scrolled to
 * show the last five. The row scales down to fit `maxWidth`, so the slot does
 * too. A flying mark aims for the slot of a mark that does not exist yet.
 */
export function markSlot(
  count: number,
  index: number,
  maxWidth: number,
): { x: number; y: number; size: number } {
  const shown = Math.min(count, MAX_MARKS)
  const natural = shown > 0 ? shown * MARK_SIZE + (shown - 1) * LINK_LENGTH : 0
  const scale = natural > maxWidth && natural > 0 ? maxWidth / natural : 1
  return {
    x: ((index - hiddenMarks(count)) * MARK_STEP + MARK_SIZE / 2) * scale,
    y: (MARK_SIZE / 2) * scale,
    size: MARK_SIZE * scale,
  }
}
