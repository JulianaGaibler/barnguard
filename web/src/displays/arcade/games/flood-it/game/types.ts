/**
 * Value types for Flood It. Dependency-free so the board rules, the generator,
 * the layout, the sessions and the nodes can all import them without cycles or
 * engine dependencies.
 */

/** A color index in `0 .. numColors-1`. */
export type Color = number

/** Which player a region belongs to. Also the value stored in `Board.owner`. */
export type PlayerId = 1 | 2

/** `Board.owner` value for a cell nobody has claimed. */
export const UNOWNED = 0

/** A grid coordinate: column 0 leftmost, row 0 topmost. */
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

/** Which of the three board-size presets a round is played at. */
export type PresetId = 'small' | 'medium' | 'large'

/**
 * How a round is played.
 *
 * `solo` and `race` are the same puzzle against a move limit, one board each.
 * `territory` is a contest for cells on one shared board, taken in turns.
 */
export type GameMode =
  | { kind: 'solo'; preset: PresetId }
  | { kind: 'race'; preset: PresetId }
  | { kind: 'territory'; preset: PresetId }

/** How a puzzle board ended. */
export type Outcome = 'flooded' | 'outOfMoves'
