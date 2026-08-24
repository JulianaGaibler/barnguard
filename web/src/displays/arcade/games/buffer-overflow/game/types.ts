/** Shared vocabulary for Buffer Overflow's engine layer. */

/**
 * The seven piece shapes, named for the letter each resembles.
 *
 * The letters describe geometry and nothing else. They are not user-facing
 * copy, and none of them appears on screen.
 */
export type PieceKind = 'I' | 'O' | 'T' | 'S' | 'Z' | 'J' | 'L'

/** Quarter turns clockwise from the spawn orientation. */
export type Rotation = 0 | 1 | 2 | 3

/** One buffer cell: the shape that filled it, or empty. */
export type Cell = PieceKind | null

/** Which seat a session belongs to. Solo always plays seat 1. */
export type PlayerId = 1 | 2

/**
 * Uptime runs until the buffer overflows. Countdown adds a clock that each
 * clear extends, and ends at whichever comes first.
 */
export type ModeKind = 'uptime' | 'countdown'

/** A mode plus its seat count, chosen from the menu. */
export interface GameMode {
  kind: ModeKind
  players: 1 | 2
}

/** Everything the player can ask of a live piece. */
export type Action =
  'left' | 'right' | 'rotateCW' | 'rotateCCW' | 'hardDrop' | 'hold'

/** A rectangle in world units. Matches `Rect` without importing the engine. */
export interface Bounds {
  x: number
  y: number
  width: number
  height: number
}

/**
 * How a clear was earned, which decides both its score and whether it keeps a
 * streak alive. `mini` is a twist into a gap too shallow to count as the real
 * thing.
 */
export type TwistKind = 'none' | 'mini' | 'full'

/** Why a session ended. */
export type EndReason = 'overflow' | 'timeUp'
