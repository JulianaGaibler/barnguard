// The in-game economy: what a hire costs, what it pays out, and where leftover
// budget lands at the end.
//
// Everything here is pure. A function either answers a question about a grid or
// returns a plan of deltas, and `match.ts` is what actually mutates state. That
// split is what lets the AI evaluate a candidate turn without committing it.
//
// Two decisions cannot be computed: which of two options a `choose` card takes,
// and which candidate a `dropCandidate` card removes. Both arrive as part of the
// turn, so resolution stays deterministic given a turn.

import { type Card, type Effect, type Floor, type Resource } from './deck'
import {
  countMetric,
  isFilled,
  orgScope,
  type Grid,
  type Player,
} from './scoring'

/** A seat that can hold leftover budget, and how much more it will take. */
export type BudgetLineSeat = { r: number; c: number; remaining: number }

/** Budget moved onto a specific seat. */
export type Funding = { r: number; c: number; amount: number }

/** What resolving an ability does, before anything is committed. */
export interface AbilityOutcome {
  selfBudget: number
  selfApprovals: number
  opponentBudget: number
  opponentApprovals: number
  funding: Funding[]
  /** Set when the card removes a face-up candidate from this floor. */
  dropFrom: Floor | null
}

const emptyOutcome = (): AbilityOutcome => ({
  selfBudget: 0,
  selfApprovals: 0,
  opponentBudget: 0,
  opponentApprovals: 0,
  funding: [],
  dropFrom: null,
})

/**
 * What a card costs this player right now.
 *
 * Discounts stack, never refund below zero, and are read from cards already in
 * the org. The card being hired is not in the grid yet, which is exactly why a
 * discount card never discounts its own purchase. Open seats carry no
 * discount.
 */
export function effectiveCost(card: Card, grid: Grid): number {
  let discount = 0
  for (const row of grid) {
    for (const cell of row) {
      if (!isFilled(cell)) continue
      const d = cell.card.discount
      if (d && (d.on === 'all' || d.on === card.floor)) discount += d.amount
    }
  }
  return Math.max(0, card.cost - discount)
}

/** Seats holding a budget line that is not yet full, richest capacity first. */
export function budgetLineSeats(grid: Grid): BudgetLineSeat[] {
  const out: BudgetLineSeat[] = []
  for (let r = 0; r < grid.length; r++) {
    const row = grid[r] ?? []
    for (let c = 0; c < row.length; c++) {
      const cell = row[c] ?? null
      if (!isFilled(cell)) continue
      const s = cell.card.scoring
      if (s.score !== 'budgetLine') continue
      out.push({ r, c, remaining: Math.max(0, s.cap - cell.budget) })
    }
  }
  return out.sort((a, b) => b.remaining - a.remaining)
}

function fund(
  grid: Grid,
  target: 'each' | number,
  amount: number | 'toFull',
): Funding[] {
  const seats = budgetLineSeats(grid).filter((s) => s.remaining > 0)
  // A numeric target takes the fullest-capacity seats. Every budget line pays
  // the same rate, so maximizing the total moved is all that matters.
  const chosen = target === 'each' ? seats : seats.slice(0, target)
  return chosen
    .map((s) => ({
      r: s.r,
      c: s.c,
      amount: amount === 'toFull' ? s.remaining : Math.min(amount, s.remaining),
    }))
    .filter((f) => f.amount > 0)
}

function credit(
  out: AbilityOutcome,
  who: 'self' | 'opponent' | 'everyone',
  resource: Resource,
  n: number,
): void {
  if (who !== 'opponent') {
    if (resource === 'budget') out.selfBudget += n
    else out.selfApprovals += n
  }
  if (who !== 'self') {
    if (resource === 'budget') out.opponentBudget += n
    else out.opponentApprovals += n
  }
}

function resolve(
  e: Effect,
  self: Player,
  opponent: Player,
  picks: number[],
  cursor: { i: number },
  out: AbilityOutcome,
): void {
  switch (e.effect) {
    case 'gain':
      credit(out, 'self', e.resource, e.amount)
      return
    case 'gainPer': {
      const scope = orgScope(e.from === 'opponent' ? opponent : self)
      credit(out, 'self', e.resource, countMetric(e.per, scope) * e.amount)
      return
    }
    case 'opponentGains':
      credit(out, 'opponent', e.resource, e.amount)
      return
    case 'everyoneGains':
      credit(out, 'everyone', e.resource, e.amount)
      return
    case 'fundBudgetLines':
      out.funding.push(...fund(self.grid, e.target, e.amount))
      return
    case 'dropCandidate':
      out.dropFrom = e.floor
      return
    case 'choose': {
      const pick = picks[cursor.i++] ?? 0
      const option = e.options[pick] ?? e.options[0] ?? []
      for (const inner of option)
        resolve(inner, self, opponent, picks, cursor, out)
      return
    }
    default: {
      const _exhaustive: never = e
      void _exhaustive
      return
    }
  }
}

/**
 * Resolve a card's on-hire ability.
 *
 * `self` must already include the new card, since abilities that scale on the
 * org count the card that triggered them. `picks` supplies one option index per
 * `choose` effect, in the order they are encountered.
 *
 * In a two-player game "a neighbour", "your opponent" and "all other players"
 * are the same person, so `from: 'opponent'` needs no targeting.
 * `everyoneGains` still pays the acting player as well.
 */
export function resolveAbility(
  card: Card,
  self: Player,
  opponent: Player,
  picks: number[] = [],
): AbilityOutcome {
  const out = emptyOutcome()
  const cursor = { i: 0 }
  for (const e of card.ability) resolve(e, self, opponent, picks, cursor, out)
  return out
}

/** How many `choose` decisions a card asks for. */
export function choiceCount(card: Card): number {
  return card.ability.filter((e) => e.effect === 'choose').length
}

/**
 * Spread leftover budget across the org's budget lines at the end of the game.
 *
 * Every budget line pays two points per dollar up to its cap, so the score
 * depends only on how much is stored, never on which line stores it. Filling
 * greedily is therefore optimal and there is nothing for the player to decide.
 */
export function fillBudgetLinesAtEnd(
  grid: Grid,
  budget: number,
): { funding: Funding[]; loose: number } {
  let left = budget
  const funding: Funding[] = []
  for (const seat of budgetLineSeats(grid)) {
    if (left <= 0) break
    const amount = Math.min(seat.remaining, left)
    if (amount <= 0) continue
    funding.push({ r: seat.r, c: seat.c, amount })
    left -= amount
  }
  return { funding, loose: left }
}
