/**
 * The buffer: a fixed grid of cells, and the four things anyone does to it.
 * Test whether a piece fits, write one in, find the full rows, drop everything
 * above them down.
 *
 * Ten columns by twenty rows, plus hidden rows above the top edge that a piece
 * spawns into. Those exist so a piece has somewhere to be before it enters
 * play: without them a spawn that overlaps the stack would have nowhere legal
 * to sit and the overflow test would have to be a special case. Row indices
 * count from the top of the hidden band, so {@link VISIBLE_TOP} is where the
 * player's view starts.
 */
import { pieceCells } from './pieces'
import type { Cell, PieceKind, Rotation } from './types'

export const COLS = 10
export const VISIBLE_ROWS = 20
/** Rows above the visible buffer that a piece spawns into. */
export const HIDDEN_ROWS = 2
export const TOTAL_ROWS = VISIBLE_ROWS + HIDDEN_ROWS
/** First row the player can see. Everything above it is the spawn band. */
export const VISIBLE_TOP = HIDDEN_ROWS

/** A buffer. `cells` is row-major over {@link TOTAL_ROWS} by {@link COLS}. */
export interface Buffer {
  cols: number
  rows: number
  cells: Cell[]
}

/**
 * A buffer of `cols` by `rows`, counting the spawn band in `rows`.
 *
 * The game always takes the defaults. The size is a parameter so a tutorial
 * card can build a genuinely smaller buffer and run the real rules on it,
 * rather than drawing a big one and cropping, which puts the stack and the
 * floor outside the card.
 */
export function createBuffer(cols = COLS, rows = TOTAL_ROWS): Buffer {
  return {
    cols,
    rows,
    cells: new Array<Cell>(cols * rows).fill(null),
  }
}

/** Rows of `b` the player can see, below the spawn band. */
export function visibleRows(b: Buffer): number {
  return b.rows - VISIBLE_TOP
}

/** Empty every cell, reusing the array so a restart allocates nothing. */
export function clearBuffer(b: Buffer): void {
  b.cells.fill(null)
}

export function cellAt(b: Buffer, x: number, y: number): Cell {
  if (x < 0 || x >= b.cols || y < 0 || y >= b.rows) return null
  return b.cells[y * b.cols + x]
}

/**
 * Whether a solid cell blocks `(x, y)`.
 *
 * Out of bounds counts as blocked on the sides and the floor, but NOT above the
 * ceiling: a piece is allowed to stick up out of the spawn band while it
 * rotates, which is what lets a kick lift it clear of the stack.
 */
export function isBlocked(b: Buffer, x: number, y: number): boolean {
  if (x < 0 || x >= b.cols || y >= b.rows) return true
  if (y < 0) return false
  return b.cells[y * b.cols + x] !== null
}

/** Whether `kind` at `rot` fits with its box's top-left at `(x, y)`. */
export function fits(
  b: Buffer,
  kind: PieceKind,
  rot: Rotation,
  x: number,
  y: number,
): boolean {
  for (const c of pieceCells(kind, rot)) {
    if (isBlocked(b, x + c.x, y + c.y)) return false
  }
  return true
}

/** Write a piece into the buffer. Cells above the ceiling are dropped. */
export function lockPiece(
  b: Buffer,
  kind: PieceKind,
  rot: Rotation,
  x: number,
  y: number,
): void {
  for (const c of pieceCells(kind, rot)) {
    const cx = x + c.x
    const cy = y + c.y
    if (cx < 0 || cx >= b.cols || cy < 0 || cy >= b.rows) continue
    b.cells[cy * b.cols + cx] = kind
  }
}

/** Indices of every full row, top to bottom. */
export function fullRows(b: Buffer): number[] {
  const rows: number[] = []
  for (let y = 0; y < b.rows; y++) {
    let full = true
    for (let x = 0; x < b.cols; x++) {
      if (b.cells[y * b.cols + x] === null) {
        full = false
        break
      }
    }
    if (full) rows.push(y)
  }
  return rows
}

/**
 * Remove `rows` and drop everything above them down.
 *
 * Written as a single downward compaction rather than one splice per row, so
 * clearing four rows costs the same walk as clearing one and no intermediate
 * array is built.
 */
export function clearRows(b: Buffer, rows: readonly number[]): void {
  if (rows.length === 0) return
  const doomed = new Set(rows)
  let write = b.rows - 1
  for (let read = b.rows - 1; read >= 0; read--) {
    if (doomed.has(read)) continue
    if (write !== read) {
      for (let x = 0; x < b.cols; x++) {
        b.cells[write * b.cols + x] = b.cells[read * b.cols + x]
      }
    }
    write--
  }
  for (; write >= 0; write--) {
    for (let x = 0; x < b.cols; x++) b.cells[write * b.cols + x] = null
  }
}
