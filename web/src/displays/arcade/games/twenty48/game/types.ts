/**
 * Shared vocabulary for 2048: the board model, the result of a move, and the
 * per-run modes. Row 0 is the top row and cell indices are row-major, so `index
 * = row * SIZE + col` throughout.
 */

/** Board edge length in cells. */
export const SIZE = 4

/** Number of cells on a board. */
export const CELLS = SIZE * SIZE

/** A swipe or arrow direction. */
export type Direction = 'up' | 'down' | 'left' | 'right'

/** Which board a player sits at in versus. */
export type PlayerId = 1 | 2

/** How a run was started. */
export type GameMode = { kind: '1p' } | { kind: '2p' }

/** A world-space rectangle. Mirrors `Rect` without importing the engine. */
export interface Bounds {
  x: number
  y: number
  width: number
  height: number
}

/**
 * One tile on the board.
 *
 * `id` is what lets the scene follow a tile through a move: a tile that slides
 * keeps its id, a tile produced by a merge gets a fresh one, and the two tiles
 * consumed by that merge keep theirs until their slide finishes.
 */
export interface Tile {
  id: number
  value: number
  /** Row-major cell index, `0` to `CELLS - 1`. */
  index: number
}

/**
 * A whole board. Immutable: {@link move} and {@link spawnTile} return a new state
 * rather than mutating this one, so a caller can hold on to the previous state
 * while the scene is still animating out of it.
 */
export interface BoardState {
  readonly tiles: readonly Tile[]
  readonly score: number
  /** Largest value present. Drives the milestone moment and the tile ramp. */
  readonly highest: number
  /** Whether 2048 has been reached at any point in this run. */
  readonly won: boolean
  readonly nextTileId: number
  /** How many tiles have been spawned, the index into the spawn stream. */
  readonly spawnOrdinal: number
}

/** A tile that changed cell during a move. */
export interface Slide {
  id: number
  from: number
  to: number
}

/** Two tiles becoming one. */
export interface Merge {
  /** The new tile's id. Not either of `consumed`. */
  id: number
  /** Cell the merged tile lands in. */
  at: number
  /** Value after merging, so twice either source. */
  value: number
  /** The two tiles absorbed, which slide onto `at` and are then discarded. */
  consumed: readonly [number, number]
}

/**
 * Everything that happened in one move, and everything the scene needs to
 * animate it. The scene reads only this: it never inspects the board to work
 * out what changed.
 */
export interface MoveResult {
  /** False when nothing shifted, in which case no tile may be spawned. */
  moved: boolean
  state: BoardState
  /** Sum of the merged tiles' values, already added to `state.score`. */
  gained: number
  slides: readonly Slide[]
  merges: readonly Merge[]
  /** Set when this move produced a value above the previous highest. */
  newHighest: number | null
  /** True only on the move that first reaches 2048. */
  reached2048: boolean
}
