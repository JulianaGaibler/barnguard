// Board evaluation for the computer opponent.
//
// Kept separate from the search so the two can be measured independently: most
// of the AI's strength comes from what a position is worth, not from how far
// ahead it looks.
//
// The subtle part is that a half-built org has no fixed layout. Cards are placed
// into a 5x5 working grid and only cropped to 3x3 at the end, so a card on the
// edge of a two-card org is not yet in any particular row. Scoring the current
// bounding box treats a provisional shape as settled and badly overrates
// position bonuses early. Instead every 3x3 window that could still become the
// final org is scored and the results averaged. There are nine of those on the
// first turn and exactly one once the org spans three in both directions, so
// positional scores firm up on their own as the player commits.

import { bounds, seatsFilled, WORKING, type Side } from './rules/match'
import { fillBudgetLinesAtEnd } from './rules/economy'
import { isFilled, scoreOrg, SEAT_COUNT, type Cell } from './rules/scoring'

export interface Weights {
  /** Worth of a dollar that will not fit on a budget line but still buys cards. */
  looseBudget: number
  /**
   * Total option value of holding approvals, on top of the point each is worth
   * at the end.
   *
   * An approval buys the right to move the marker or redeal a bad row. That is
   * worth having once, not ten times, so the value saturates: holding the last
   * approval is what preserves the ability to react, while the tenth adds
   * almost nothing. A linear term prices those identically, which is what makes
   * a search spend down to zero and redeal on nearly every turn.
   */
  approvalReserve: number
  /** How many approvals capture most of that reserve value. */
  approvalReserveScale: number
  /**
   * How much the opponent's score counts against this one.
   *
   * `0` plays pure solitaire and ignores the other player. `1` weighs a point
   * denied exactly as much as a point earned, which wins more but drags both
   * players' totals down, because it will give up three points to cost the
   * opponent four.
   */
  denial: number
}

export const DEFAULT_WEIGHTS: Weights = {
  looseBudget: 0.15,
  approvalReserve: 2,
  approvalReserveScale: 2,
  denial: 0.3,
}

/**
 * Option value of holding `n` approvals with `seatsLeft` hires still to make.
 *
 * Saturating in `n`, because the right to react is worth having once rather
 * than ten times, and fading to nothing as the org fills, because an approval
 * on the last turn buys no options at all: it is worth exactly the point it
 * scores. Holding one back matters early and not at all late.
 */
export function approvalValue(
  n: number,
  seatsLeft: number,
  weights: Weights,
): number {
  const k = Math.max(1e-6, weights.approvalReserveScale)
  const horizon = Math.max(0, Math.min(1, seatsLeft / SEAT_COUNT))
  return weights.approvalReserve * (1 - Math.exp(-n / k)) * horizon
}

/** Every 3x3 window of the working grid that still covers all placed cards. */
export function candidateWindows(grid: readonly (readonly Cell[])[]): {
  r0: number
  c0: number
}[] {
  const b = bounds(grid as Cell[][])
  const last = WORKING - 3
  if (!b) return [{ r0: 1, c0: 1 }]
  const out: { r0: number; c0: number }[] = []
  for (let r0 = Math.max(0, b.maxR - 2); r0 <= Math.min(b.minR, last); r0++) {
    for (let c0 = Math.max(0, b.maxC - 2); c0 <= Math.min(b.minC, last); c0++) {
      out.push({ r0, c0 })
    }
  }
  return out.length > 0
    ? out
    : [{ r0: Math.min(b.minR, last), c0: Math.min(b.minC, last) }]
}

/** A copy of the working grid with leftover budget poured into budget lines. */
function settled(side: Side): { grid: Cell[][]; loose: number } {
  const grid = side.grid.map((row) =>
    row.map((cell) =>
      cell && isFilled(cell) ? { card: cell.card, budget: cell.budget } : cell,
    ),
  )
  const { funding, loose } = fillBudgetLinesAtEnd(grid, side.budget)
  for (const f of funding) {
    const cell = grid[f.r]![f.c]
    if (cell && isFilled(cell)) cell.budget += f.amount
  }
  return { grid, loose }
}

const crop = (grid: Cell[][], r0: number, c0: number): Cell[][] =>
  Array.from({ length: 3 }, (_, r) =>
    Array.from({ length: 3 }, (_, c) => grid[r0 + r]?.[c0 + c] ?? null),
  )

/**
 * What one org is worth to its owner.
 *
 * With `expectedWindows` the score is averaged over every layout the org could
 * still settle into. Without it, only the current bounding box is scored, which
 * is cheaper and is what the weaker difficulties use.
 */
export function orgValue(
  side: Side,
  weights: Weights,
  expectedWindows: boolean,
): number {
  const { grid, loose } = settled(side)
  const windows = expectedWindows
    ? candidateWindows(grid)
    : candidateWindows(grid).slice(0, 1)

  let points = 0
  for (const w of windows) {
    points += scoreOrg({
      grid: crop(grid, w.r0, w.c0),
      approvals: side.approvals,
    }).total
  }
  points /= windows.length

  const seatsLeft = SEAT_COUNT - seatsFilled(side.grid)
  return (
    points +
    loose * weights.looseBudget +
    approvalValue(side.approvals, seatsLeft, weights)
  )
}
