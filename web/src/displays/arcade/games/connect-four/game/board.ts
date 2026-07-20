/**
 * Connect Four board rules, pure and allocation-light. The board is a flat
 * `Int8Array` plus a per-column height, so dropping and undoing a piece is O(1)
 * with no allocation, which is what lets the AI search run make/unmake straight
 * on a scratch board (see `game/ai.ts`).
 *
 * Coordinates: column 0..6 left→right, row 0 at the bottom. Cell index is `row
 *
 * - COLS + col`.
 */
import type { CellRef, Player } from './types'

export const COLS = 7
export const ROWS = 6
export const CONNECT = 4
const CELL_COUNT = COLS * ROWS

/** Columns tried center-first, so alpha-beta prunes more of the AI search. */
const CENTER_FIRST: readonly number[] = [3, 2, 4, 1, 5, 0, 6]

export interface Board {
  /** `row * COLS + col` → 0 empty / 1 / 2. */
  readonly cells: Int8Array
  /** Filled count per column (0..ROWS); the next drop lands at this row. */
  readonly heights: Int8Array
  /** Side to move. */
  turn: Player
  /** Pieces placed so far (for faster-win / slower-loss scoring and draw test). */
  ply: number
  /** Player who just completed a line, or 0 while the game is live. */
  winner: 0 | Player
}

export function createBoard(): Board {
  return {
    cells: new Int8Array(CELL_COUNT),
    heights: new Int8Array(COLS),
    turn: 1,
    ply: 0,
    winner: 0,
  }
}

export function cloneBoard(b: Board): Board {
  return {
    cells: b.cells.slice(),
    heights: b.heights.slice(),
    turn: b.turn,
    ply: b.ply,
    winner: b.winner,
  }
}

export function cellAt(b: Board, col: number, row: number): number {
  return b.cells[row * COLS + col]
}

export function isFull(b: Board): boolean {
  return b.ply >= CELL_COUNT
}

/**
 * The row a disc dropped in `col` would land on, or null when the column is
 * full.
 */
export function dropRow(b: Board, col: number): number | null {
  const h = b.heights[col]
  return h < ROWS ? h : null
}

/** Columns that still have room, center-first. */
export function legalColumns(b: Board): number[] {
  const out: number[] = []
  for (const col of CENTER_FIRST) if (b.heights[col] < ROWS) out.push(col)
  return out
}

/**
 * Drop the side-to-move's piece in `col`, flip the turn, and set `winner` if
 * the piece completed a line. Assumes the column has room (guard with
 * `dropRow`).
 */
export function makeMove(b: Board, col: number): void {
  const row = b.heights[col]
  const player = b.turn
  b.cells[row * COLS + col] = player
  b.heights[col] = row + 1
  b.ply += 1
  b.turn = player === 1 ? 2 : 1
  if (winningLineAt(b, col, row)) b.winner = player
}

/** Exactly reverse the matching `makeMove(b, col)`. */
export function unmakeMove(b: Board, col: number): void {
  const row = b.heights[col] - 1
  b.cells[row * COLS + col] = 0
  b.heights[col] = row
  b.ply -= 1
  b.turn = b.turn === 1 ? 2 : 1
  b.winner = 0
}

const DIRECTIONS: ReadonlyArray<readonly [number, number]> = [
  [1, 0], // horizontal
  [0, 1], // vertical
  [1, 1], // diagonal /
  [1, -1], // diagonal \
]

/** True when the piece at (col, row) sits in a run of `CONNECT` of its owner. */
function winningLineAt(b: Board, col: number, row: number): boolean {
  const player = b.cells[row * COLS + col]
  if (player === 0) return false
  for (const [dc, dr] of DIRECTIONS) {
    let run = 1
    run += countRun(b, col, row, dc, dr, player)
    run += countRun(b, col, row, -dc, -dr, player)
    if (run >= CONNECT) return true
  }
  return false
}

function countRun(
  b: Board,
  col: number,
  row: number,
  dc: number,
  dr: number,
  player: number,
): number {
  let n = 0
  let c = col + dc
  let r = row + dr
  while (
    c >= 0 &&
    c < COLS &&
    r >= 0 &&
    r < ROWS &&
    b.cells[r * COLS + c] === player
  ) {
    n += 1
    c += dc
    r += dr
  }
  return n
}

/**
 * The cells forming the win through (col, row), or null if there isn't one.
 * Used to highlight the winning line; returns the connected run (>= CONNECT
 * cells).
 */
export function winningCells(
  b: Board,
  col: number,
  row: number,
): CellRef[] | null {
  const player = b.cells[row * COLS + col]
  if (player === 0) return null
  for (const [dc, dr] of DIRECTIONS) {
    const back = collectRun(b, col, row, -dc, -dr, player)
    const fwd = collectRun(b, col, row, dc, dr, player)
    if (back.length + 1 + fwd.length >= CONNECT) {
      return [...back.reverse(), { col, row }, ...fwd]
    }
  }
  return null
}

function collectRun(
  b: Board,
  col: number,
  row: number,
  dc: number,
  dr: number,
  player: number,
): CellRef[] {
  const out: CellRef[] = []
  let c = col + dc
  let r = row + dr
  while (
    c >= 0 &&
    c < COLS &&
    r >= 0 &&
    r < ROWS &&
    b.cells[r * COLS + c] === player
  ) {
    out.push({ col: c, row: r })
    c += dc
    r += dr
  }
  return out
}
