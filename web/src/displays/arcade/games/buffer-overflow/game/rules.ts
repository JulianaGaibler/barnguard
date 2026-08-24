/**
 * What a live piece is allowed to do: shift, turn (with wall kicks), fall, and
 * eventually lock.
 *
 * Every function here is a query over a {@link Buffer} plus an
 * {@link ActivePiece}. Nothing mutates the piece in place, so a caller can test
 * a move and keep the result only if it likes it, and nothing reaches the scene
 * or the clock.
 */
import { fits, isBlocked, lockPiece, VISIBLE_TOP, type Buffer } from './board'
import {
  kicksFor,
  pieceCells,
  spawnColumn,
  T_CORNERS,
  T_FRONT_CORNERS,
} from './pieces'
import type { PieceKind, Rotation, TwistKind } from './types'

/** A piece in play, positioned by the top-left corner of its own box. */
export interface ActivePiece {
  kind: PieceKind
  rot: Rotation
  x: number
  y: number
}

/**
 * How many times a move or turn may restart the lock timer before the piece
 * locks regardless.
 *
 * Without a cap, resetting on every input lets a player hold a piece at the
 * floor forever by turning it back and forth. That is a way to rest
 * indefinitely in Uptime, and in Countdown it is a way to bank the clock until
 * the buffer is arranged, which would leave nothing to count down.
 */
export const LOCK_RESET_LIMIT = 15

/** A piece entering `b`, in the spawn band above the visible rows. */
export function spawnPiece(kind: PieceKind, cols = 10): ActivePiece {
  return { kind, rot: 0, x: spawnColumn(kind, cols), y: 0 }
}

/** Whether a piece could enter at all, which is the overflow test. */
export function canSpawn(b: Buffer, kind: PieceKind): boolean {
  const p = spawnPiece(kind, b.cols)
  return fits(b, p.kind, p.rot, p.x, p.y)
}

/** The piece shifted by `(dx, dy)`, or null if that lands in something. */
export function tryShift(
  b: Buffer,
  p: ActivePiece,
  dx: number,
  dy: number,
): ActivePiece | null {
  const x = p.x + dx
  const y = p.y + dy
  return fits(b, p.kind, p.rot, x, y) ? { ...p, x, y } : null
}

/** Whether anything solid sits directly under the piece. */
export function isGrounded(b: Buffer, p: ActivePiece): boolean {
  return !fits(b, p.kind, p.rot, p.x, p.y + 1)
}

/** The outcome of a turn that found somewhere to go. */
export interface RotationResult {
  piece: ActivePiece
  /**
   * Which entry of the kick table was used. Zero means the piece turned in
   * place. A non-zero index is what distinguishes a twist from an ordinary turn
   * that happens to end beside a wall.
   */
  kickIndex: number
}

/** Turn `dir` quarter-turns clockwise, trying each kick until one fits. */
export function tryRotate(
  b: Buffer,
  p: ActivePiece,
  dir: 1 | -1,
): RotationResult | null {
  const to = (((p.rot + dir) % 4) + 4) % 4
  const kicks = kicksFor(p.kind, p.rot, to as Rotation)
  for (let i = 0; i < kicks.length; i++) {
    const x = p.x + kicks[i].x
    const y = p.y + kicks[i].y
    if (fits(b, p.kind, to as Rotation, x, y)) {
      return { piece: { ...p, rot: to as Rotation, x, y }, kickIndex: i }
    }
  }
  return null
}

/** The piece dropped as far as it will go. */
export function hardDropTarget(b: Buffer, p: ActivePiece): ActivePiece {
  let y = p.y
  while (fits(b, p.kind, p.rot, p.x, y + 1)) y++
  return { ...p, y }
}

/** Rows the piece would fall through on a hard drop, for scoring it. */
export function dropDistance(b: Buffer, p: ActivePiece): number {
  return hardDropTarget(b, p).y - p.y
}

/** Write the piece into the buffer. */
export function commit(b: Buffer, p: ActivePiece): void {
  lockPiece(b, p.kind, p.rot, p.x, p.y)
}

/**
 * Whether a locked piece sat entirely in the spawn band, which is the other way
 * a run ends: the stack reached the ceiling and there was no room to play.
 */
export function lockedOutOfView(p: ActivePiece): boolean {
  return pieceCells(p.kind, p.rot).every((c) => p.y + c.y < VISIBLE_TOP)
}

/**
 * Classify a lock as a twist.
 *
 * The test is the standard three-corner one, and it only applies to `T`: at
 * least three of the four corners of its box are occupied, and the lock came
 * straight from a rotation rather than from a shift or a drop. When both
 * corners on the side the `T` faces are filled it is the real thing, and when
 * only one is it is a mini, worth less.
 *
 * A rotation that needed the last kick in the table is promoted to full
 * regardless. That entry is the deep two-row lift, and a piece that reached its
 * slot that way could not have got there by falling.
 *
 * @param kickIndex Which kick the rotation used, from {@link tryRotate}.
 */
export function classifyTwist(
  b: Buffer,
  p: ActivePiece,
  lockedByRotation: boolean,
  kickIndex: number,
): TwistKind {
  if (!lockedByRotation || p.kind !== 'T') return 'none'
  let filled = 0
  for (const c of T_CORNERS) {
    if (isBlocked(b, p.x + c.x, p.y + c.y)) filled++
  }
  if (filled < 3) return 'none'
  const front = T_FRONT_CORNERS[p.rot]
  const frontFilled = front.filter((c) =>
    isBlocked(b, p.x + c.x, p.y + c.y),
  ).length
  if (frontFilled === 2) return 'full'
  return kickIndex === 4 ? 'full' : 'mini'
}

/**
 * The lock timer for the piece currently resting on the stack.
 *
 * A piece that touches down does not lock at once: it gets
 * {@link LOCK_RESET_LIMIT} chances to be nudged or turned first, each of which
 * restarts the timer. That is what makes a fast drop recoverable on a
 * touchscreen, where a finger is slower and less precise than a key.
 */
export interface LockTimer {
  /** Seconds resting on the stack since the last reset. */
  elapsed: number
  /** Moves and turns that have restarted the timer for this piece. */
  resets: number
  /** Whether the piece is currently resting on something. */
  grounded: boolean
}

export function createLockTimer(): LockTimer {
  return { elapsed: 0, resets: 0, grounded: false }
}

/** Start a fresh piece. Called on spawn and after a hold swap. */
export function resetLockTimer(t: LockTimer): void {
  t.elapsed = 0
  t.resets = 0
  t.grounded = false
}

/**
 * Tell the timer the piece moved.
 *
 * Restarts the countdown while resets remain, and does nothing once they are
 * spent, at which point the piece locks on the timer it already has running.
 */
export function noteMove(t: LockTimer, grounded: boolean): void {
  if (!grounded) {
    // Moved back into open air, so there is no lock in progress to restart.
    // The reset budget carries over: a piece that scrapes along a ledge should
    // not get a fresh fifteen every time it clears an edge.
    t.grounded = false
    t.elapsed = 0
    return
  }
  if (!t.grounded) {
    t.grounded = true
    t.elapsed = 0
    return
  }
  if (t.resets >= LOCK_RESET_LIMIT) return
  t.resets++
  t.elapsed = 0
}

/**
 * Advance the timer. Returns true when the piece should lock now.
 *
 * `delay` is the resting time a piece is given, in seconds.
 */
export function tickLockTimer(
  t: LockTimer,
  dt: number,
  delay: number,
): boolean {
  if (!t.grounded) return false
  t.elapsed += dt
  return t.elapsed >= delay
}
