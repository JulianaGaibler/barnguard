/**
 * The game around the rounds: running totals, the target, and who won.
 *
 * @remarks
 *   The RNG lives on the state as a plain number rather than a closure, so a
 *   match replays exactly from its seed and a test can pin a deal without
 *   threading a generator through every call.
 */
import type { RoundScore, SeatId } from './player'

/** Points that end the game. Reached at the END of a round, never mid-round. */
export const TARGET_SCORE = 200

export interface MatchState {
  totals: number[]
  /** Rounds finished so far. */
  round: number
  target: number
  rngState: number
  over: boolean
  /** Every seat tied at the top once the target is reached. */
  winners: SeatId[]
}

export function createMatch(
  seats: number,
  seed: number,
  target = TARGET_SCORE,
): MatchState {
  return {
    totals: Array.from({ length: seats }, () => 0),
    round: 0,
    target,
    rngState: seed >>> 0,
    over: false,
    winners: [],
  }
}

/** One LCG step. Kept on the state so `undo` and replay stay possible. */
export function nextFloat(state: MatchState): number {
  state.rngState = (state.rngState * 1664525 + 1013904223) >>> 0
  return state.rngState / 2 ** 32
}

/** A generator bound to a match, for the deck helpers. */
export const randomFor =
  (state: MatchState): (() => number) =>
  () =>
    nextFloat(state)

/**
 * Add a round's scores and decide whether that ended the game.
 *
 * Every seat tied at the top wins together. The ruleset leaves ties open, and a
 * booth game that declares two winners beats one that invents a tiebreak nobody
 * at the table agreed to.
 */
export function applyRoundScores(
  state: MatchState,
  scores: readonly RoundScore[],
): void {
  for (const score of scores) state.totals[score.seat] += score.total
  state.round++
  if (Math.max(...state.totals) >= state.target) endMatch(state)
}

/**
 * Stop the match where it stands and settle on a winner.
 *
 * The target is what normally ends a game, but a booth game also has to end
 * when the people playing it have to leave. Whoever is ahead at that point wins
 * on the same terms as anyone who reached 200, ties included.
 */
export function endMatch(state: MatchState): void {
  const best = Math.max(...state.totals)
  state.over = true
  state.winners = state.totals
    .map((total, seat) => ({ total, seat }))
    .filter((t) => t.total === best)
    .map((t) => t.seat)
}

export interface Standing {
  seat: SeatId
  total: number
  /** Shared by every seat on the same total. */
  rank: number
}

/**
 * Highest first, with ties sharing a rank and seat order breaking display
 * order.
 */
export function standings(state: MatchState): Standing[] {
  const rows = state.totals
    .map((total, seat) => ({ seat, total, rank: 1 }))
    .sort((a, b) => b.total - a.total || a.seat - b.seat)
  rows.forEach((row, i) => {
    const prev = rows[i - 1]
    row.rank = prev && prev.total === row.total ? prev.rank : i + 1
  })
  return rows
}
