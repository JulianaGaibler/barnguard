/**
 * Value types for Connect Four. Dependency-free so the board rules, AI adapter,
 * session, and nodes can all import them without cycles.
 */

/** A player. 1 is blue (left, human in single-player); 2 is red (right / AI). */
export type Player = 1 | 2

/** A board cell: 0 empty, or the player who owns it. */
export type Cell = 0 | Player

/** Single-player AI strength. */
export type Difficulty = 'easy' | 'medium' | 'hard'

/** How a match is played: two humans, or one human against the AI. */
export type GameMode = { kind: '2p' } | { kind: 'ai'; difficulty: Difficulty }

/**
 * Cumulative wins per side across a play session (left = player 1, right =
 * player 2/AI).
 */
export interface MatchScore {
  teamL: number
  teamR: number
}

/** A cell coordinate: column 0..6 (left→right), row 0 at the bottom. */
export interface CellRef {
  col: number
  row: number
}
