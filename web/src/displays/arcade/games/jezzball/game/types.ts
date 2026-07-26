/**
 * Value types for JezzBall. Dependency-free so the grid rules, layout, collider
 * builder, session, and nodes can all import them without cycles or engine
 * dependencies.
 */

/** A grid cell's state. Stored as bytes in the grid's `Uint8Array`. */
export const CELL_OPEN = 0
export const CELL_FILLED = 1
export const CELL_WALL = 2
export type CellState = typeof CELL_OPEN | typeof CELL_FILLED | typeof CELL_WALL

/** A grid coordinate: column 0..cols-1 (left→right), row 0 at the top. */
export interface CellRef {
  col: number
  row: number
}

/** An axis-aligned world-space rectangle (top-left origin, y grows downward). */
export interface Bounds {
  x: number
  y: number
  width: number
  height: number
}

/** A wall (and a two-finger gesture) is aligned to one of two axes. */
export type Orientation = 'horizontal' | 'vertical'

/** Which board a value belongs to in multiplayer; also the accent color key. */
export type PlayerId = 1 | 2

/** How a game is played: one board for score, or two boards head-to-head. */
export type GameMode = { kind: '1p' } | { kind: '2p' }

/**
 * The four scoring components tracked per board, plus their sum. Kept as raw
 * components so the end-of-level breakdown can be shown or animated piece by
 * piece.
 */
export interface ScoreBreakdown {
  /** Points for area captured during play. */
  elimination: number
  /** Bonus for capturing beyond the target percentage. */
  fillBonus: number
  /** Bonus for finishing a level quickly. */
  timeBonus: number
  /** Bonus for lives still held. */
  livesBonus: number
  /** Sum of the above. */
  total: number
}

/** A run of colored text, e.g. a winner's name in their team color. */
export interface TextSegment {
  text: string
  color: string
}
