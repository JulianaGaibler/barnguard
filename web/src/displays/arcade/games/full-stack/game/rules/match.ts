// The match: two orgs, two shared shortlists, and the floor marker between them.
//
// An org is built in a 5x5 working grid rather than a 3x3. The first hire lands
// dead centre, and every later one must touch an existing card without pushing
// the bounding box past 3x3. A fixed 3x3 array would wrongly forbid growing up
// or left from the first card. Nine connected cards inside a 3x3 box can only be
// a full 3x3, so `normalize` always finds one at the end.
//
// `applyTurn` mutates and returns an `Undo` that restores the state exactly,
// including the deck order when a refill triggered a reshuffle. That is what
// lets the AI walk the tree without copying orgs, and it is why the random
// source is a number on the state rather than a closure: undo has to rewind it
// too, or re-applying a turn would deal different cards.

import { DECK, type Card, type Floor } from './deck'
import { effectiveCost, fillBudgetLinesAtEnd, resolveAbility } from './economy'
import {
  isFilled,
  isOpenSeat,
  scoreOrg,
  SEAT_COUNT,
  type Cell,
  type Player,
  type Pos,
  type ScoreBreakdown,
} from './scoring'

/** Working grid width. A 3x3 org anchored at the centre can reach every cell. */
export const WORKING = 5
const CENTER = 2

export const FLOORS: readonly Floor[] = ['management', 'ic']
export const SHORTLIST_SIZE = 3
export const STARTING_BUDGET = 15
export const STARTING_APPROVALS = 2
/** Taking a card face down instead of hiring it. */
export const OPEN_SEAT_BUDGET = 6
export const OPEN_SEAT_APPROVALS = 2

export type PlayerId = 0 | 1
export type Slot = 0 | 1 | 2

export interface Side {
  grid: Cell[][]
  budget: number
  approvals: number
}

export interface MatchState {
  sides: [Side, Side]
  /** Draw pile per floor. Cards are drawn off the end. */
  decks: Record<Floor, Card[]>
  discards: Record<Floor, Card[]>
  /**
   * Three face-up candidates per floor. A hole is refilled before the turn
   * ends.
   */
  shortlists: Record<Floor, (Card | null)[]>
  marker: Floor
  turn: PlayerId
  /** Hires made across both orgs. The match ends at eighteen. */
  seatsTaken: number
  rngState: number
}

// A counter-based generator so `Undo` can rewind it by restoring one number.
function nextRandom(state: MatchState): number {
  state.rngState = (state.rngState * 1664525 + 1013904223) >>> 0
  return state.rngState / 2 ** 32
}

function shuffle(cards: Card[], state: MatchState): void {
  for (let i = cards.length - 1; i > 0; i--) {
    const j = Math.floor(nextRandom(state) * (i + 1))
    ;[cards[i], cards[j]] = [cards[j]!, cards[i]!]
  }
}

const emptyGrid = (): Cell[][] =>
  Array.from({ length: WORKING }, () =>
    Array.from({ length: WORKING }, () => null as Cell),
  )

export function createMatch(seed: number): MatchState {
  const state: MatchState = {
    sides: [
      {
        grid: emptyGrid(),
        budget: STARTING_BUDGET,
        approvals: STARTING_APPROVALS,
      },
      {
        grid: emptyGrid(),
        budget: STARTING_BUDGET,
        approvals: STARTING_APPROVALS,
      },
    ],
    decks: { management: [], ic: [] },
    discards: { management: [], ic: [] },
    shortlists: { management: [], ic: [] },
    marker: 'ic',
    turn: 0,
    seatsTaken: 0,
    rngState: seed >>> 0,
  }
  for (const floor of FLOORS) {
    state.decks[floor] = DECK.filter((c) => c.floor === floor).slice()
    shuffle(state.decks[floor], state)
    state.shortlists[floor] = Array.from({ length: SHORTLIST_SIZE }, () => null)
  }
  refill(state)
  // A coin flip for who opens, taken from the same seeded source.
  state.turn = nextRandom(state) < 0.5 ? 0 : 1
  return state
}

/**
 * Top both shortlists back up to three, reshuffling a floor's discard pile into
 * its deck when the deck runs dry. Across a whole match each floor loses at
 * most eighteen of its thirty-nine cards to orgs, so a floor can never actually
 * run out of cards to show.
 */
function refill(state: MatchState): void {
  for (const floor of FLOORS) {
    const list = state.shortlists[floor]
    for (let i = 0; i < SHORTLIST_SIZE; i++) {
      if (list[i]) continue
      if (state.decks[floor].length === 0) {
        if (state.discards[floor].length === 0) break
        state.decks[floor] = state.discards[floor]
        state.discards[floor] = []
        shuffle(state.decks[floor], state)
      }
      list[i] = state.decks[floor].pop() ?? null
    }
  }
}

// Placement

export type Bounds = {
  minR: number
  maxR: number
  minC: number
  maxC: number
} | null

/** The smallest box covering every placed card, or null for an empty org. */
export function bounds(grid: Cell[][]): Bounds {
  let b: Bounds = null
  for (let r = 0; r < WORKING; r++) {
    for (let c = 0; c < WORKING; c++) {
      if (grid[r]![c] === null) continue
      b = b
        ? {
            minR: Math.min(b.minR, r),
            maxR: Math.max(b.maxR, r),
            minC: Math.min(b.minC, c),
            maxC: Math.max(b.maxC, c),
          }
        : { minR: r, maxR: r, minC: c, maxC: c }
    }
  }
  return b
}

const touchesACard = (grid: Cell[][], r: number, c: number): boolean =>
  [
    [r - 1, c],
    [r + 1, c],
    [r, c - 1],
    [r, c + 1],
  ].some(([nr, nc]) => grid[nr!]?.[nc!] != null)

/**
 * Where the next card may go: orthogonally touching what is already there, and
 * keeping the org inside a 3x3 box. The very first card is pinned to the
 * centre, which costs nothing because the working grid is only a coordinate
 * space.
 */
export function legalPlacements(grid: Cell[][]): Pos[] {
  const b = bounds(grid)
  if (!b) return [{ r: CENTER, c: CENTER }]
  const out: Pos[] = []
  for (let r = 0; r < WORKING; r++) {
    for (let c = 0; c < WORKING; c++) {
      if (grid[r]![c] !== null) continue
      if (!touchesACard(grid, r, c)) continue
      const h = Math.max(b.maxR, r) - Math.min(b.minR, r)
      const w = Math.max(b.maxC, c) - Math.min(b.minC, c)
      if (h <= 2 && w <= 2) out.push({ r, c })
    }
  }
  return out
}

/** Crop a finished working grid down to the 3x3 the rules score. */
export function normalize(grid: Cell[][]): Cell[][] {
  const b = bounds(grid)
  if (!b)
    return [
      [null, null, null],
      [null, null, null],
      [null, null, null],
    ]
  return Array.from({ length: 3 }, (_, r) =>
    Array.from({ length: 3 }, (_, c) => grid[b.minR + r]?.[b.minC + c] ?? null),
  )
}

export const seatsFilled = (grid: Cell[][]): number =>
  grid.flat().filter((cell) => cell !== null).length

// Turns
//
// A turn is two decisions, not one. Spending an approval to redraw deals three
// new candidates, and the player picks a hire only after seeing them, so the
// approval step and the hire step are applied separately. `applyTurn` bundles
// both for callers that already know all of it.

/** One approval spent, and what it buys. */
export type ApprovalStep = 'moveMarker' | 'refreshFloor'

/**
 * The approvals a turn spends before its hire, in the order it spends them.
 *
 * Both steps are open on the same turn at one approval each, and the order is
 * part of the plan because it changes the outcome. Switching and then redealing
 * deals a fresh row on the floor the hire comes from. Redealing and then
 * switching leaves that row behind for the other player.
 */
export type ApprovalPlan = readonly ApprovalStep[]

/** The mandatory half of a turn: take a candidate and place it. */
export interface Hire {
  /** Pay for the card, or take it face down for budget and approvals instead. */
  take: 'hire' | 'openSeat'
  slot: Slot
  at: Pos
  /** One option index per `choose` effect, in the order they resolve. */
  picks: number[]
}

export interface Turn extends Hire {
  approval: ApprovalPlan
}

export interface ApprovalUndo {
  steps: ApprovalPlan
  actor: PlayerId
  approvals: number
  marker: Floor
  rngState: number
  decks: Record<Floor, Card[]>
  discards: Record<Floor, Card[]>
  shortlists: Record<Floor, (Card | null)[]>
}

export interface HireUndo {
  marker: Floor
  turn: PlayerId
  seatsTaken: number
  rngState: number
  sides: { budget: number; approvals: number }[]
  at: Pos
  actor: PlayerId
  decks: Record<Floor, Card[]>
  discards: Record<Floor, Card[]>
  shortlists: Record<Floor, (Card | null)[]>
}

export interface Undo {
  approval: ApprovalUndo
  hire: HireUndo
}

const asPlayer = (side: Side): Player => ({
  grid: side.grid,
  approvals: side.approvals,
})

const otherFloor = (floor: Floor): Floor =>
  floor === 'management' ? 'ic' : 'management'

const snapshotPiles = (state: MatchState) => ({
  decks: {
    management: state.decks.management.slice(),
    ic: state.decks.ic.slice(),
  },
  discards: {
    management: state.discards.management.slice(),
    ic: state.discards.ic.slice(),
  },
  shortlists: {
    management: state.shortlists.management.slice(),
    ic: state.shortlists.ic.slice(),
  },
})

function restorePiles(
  state: MatchState,
  from: ReturnType<typeof snapshotPiles>,
): void {
  state.decks.management = from.decks.management
  state.decks.ic = from.decks.ic
  state.discards.management = from.discards.management
  state.discards.ic = from.discards.ic
  state.shortlists.management = from.shortlists.management
  state.shortlists.ic = from.shortlists.ic
}

/** The floor a turn draws from, after any marker moves it pays for. */
function floorFor(state: MatchState, plan: ApprovalPlan): Floor {
  const moves = plan.filter((step) => step === 'moveMarker').length
  return moves % 2 === 1 ? otherFloor(state.marker) : state.marker
}

/** The candidate a turn takes, accounting for a marker move it pays for. */
export function candidateFor(state: MatchState, turn: Turn): Card | null {
  return state.shortlists[floorFor(state, turn.approval)][turn.slot] ?? null
}

const choiceDepth = (card: Card): number =>
  card.ability.filter((e) => e.effect === 'choose').length

function pickBits(b: number, card: Card | null): number[] {
  const n = card ? choiceDepth(card) : 0
  return Array.from({ length: n }, (_, i) => (b >> i) & 1)
}

/**
 * Every hire available right now, on the marker's current floor. Call this
 * after `applyApproval`, since a marker move or a redraw changes the answer.
 */
export function legalHires(state: MatchState): Hire[] {
  const side = state.sides[state.turn]
  const placements = legalPlacements(side.grid)
  const out: Hire[] = []
  for (let slot = 0 as Slot; slot < SHORTLIST_SIZE; slot = (slot + 1) as Slot) {
    const card = state.shortlists[state.marker][slot]
    if (!card) continue
    const affordable = effectiveCost(card, side.grid) <= side.budget
    const branches = 2 ** choiceDepth(card)
    for (const at of placements) {
      if (affordable) {
        for (let b = 0; b < branches; b++) {
          out.push({ take: 'hire', slot, at, picks: pickBits(b, card) })
        }
      }
      out.push({ take: 'openSeat', slot, at, picks: [] })
    }
  }
  return out
}

/** Rank hires by a one-ply lookahead and return the best `width` of them. */
export function bestHires(
  state: MatchState,
  hires: readonly Hire[],
  value: (state: MatchState) => number,
  width: number,
): Hire[] {
  const scored = hires.map((hire) => {
    const undo = applyHire(state, hire)
    const score = value(state)
    undoHire(state, undo)
    return { hire, score }
  })
  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, Math.max(1, width)).map((s) => s.hire)
}

/** Every complete turn, for callers that want both halves at once. */
export function legalTurns(
  state: MatchState,
  opts: { allowRefresh?: boolean } = {},
): Turn[] {
  const side = state.sides[state.turn]
  // A redraw deals unseen cards, so its outcome cannot be enumerated. Callers
  // that cannot model the unknown leave it out.
  const refresh = opts.allowRefresh !== false
  const plans: ApprovalPlan[] = [[]]
  if (side.approvals >= 1) {
    plans.push(['moveMarker'])
    if (refresh) plans.push(['refreshFloor'])
  }
  if (side.approvals >= 2 && refresh) {
    plans.push(['moveMarker', 'refreshFloor'], ['refreshFloor', 'moveMarker'])
  }

  const out: Turn[] = []
  for (const approval of plans) {
    const undo = applyApproval(state, approval)
    for (const hire of legalHires(state)) out.push({ approval, ...hire })
    undoApproval(state, undo)
  }
  return out
}

function place(grid: Cell[][], at: Pos, cell: Cell): void {
  grid[at.r]![at.c] = cell
}

/**
 * Spend the plan's approvals in order, moving the marker and dealing new rows.
 *
 * The undo covers the whole plan, since it restores a snapshot taken before the
 * first step rather than walking the steps back one at a time.
 */
export function applyApproval(
  state: MatchState,
  plan: ApprovalPlan,
): ApprovalUndo {
  const actor = state.turn
  const side = state.sides[actor]
  const undo: ApprovalUndo = {
    steps: plan.slice(),
    actor,
    approvals: side.approvals,
    marker: state.marker,
    rngState: state.rngState,
    ...snapshotPiles(state),
  }
  for (const step of plan) {
    if (side.approvals <= 0) break
    side.approvals -= 1
    if (step === 'moveMarker') {
      state.marker = otherFloor(state.marker)
      continue
    }
    const list = state.shortlists[state.marker]
    for (let i = 0; i < list.length; i++) {
      const c = list[i]
      if (c) state.discards[state.marker].push(c)
      list[i] = null
    }
    refill(state)
  }
  return undo
}

export function undoApproval(state: MatchState, undo: ApprovalUndo): void {
  state.sides[undo.actor]!.approvals = undo.approvals
  state.marker = undo.marker
  state.rngState = undo.rngState
  restorePiles(state, undo)
}

/** Take a candidate, place it, resolve its ability, then refill. */
export function applyHire(state: MatchState, hire: Hire): HireUndo {
  const actor = state.turn
  const side = state.sides[actor]
  const other = state.sides[actor === 0 ? 1 : 0]

  const undo: HireUndo = {
    marker: state.marker,
    turn: state.turn,
    seatsTaken: state.seatsTaken,
    rngState: state.rngState,
    sides: state.sides.map((s) => ({
      budget: s.budget,
      approvals: s.approvals,
    })),
    at: hire.at,
    actor,
    ...snapshotPiles(state),
  }

  const card = state.shortlists[state.marker][hire.slot] ?? null
  if (card) state.shortlists[state.marker][hire.slot] = null

  if (hire.take === 'openSeat') {
    place(side.grid, hire.at, { openSeat: true })
    side.budget += OPEN_SEAT_BUDGET
    side.approvals += OPEN_SEAT_APPROVALS
  } else if (card) {
    side.budget -= effectiveCost(card, side.grid)
    place(side.grid, hire.at, { card, budget: 0 })

    // The new card counts itself in anything that scales on the org.
    const out = resolveAbility(
      card,
      asPlayer(side),
      asPlayer(other),
      hire.picks,
    )
    side.budget += out.selfBudget
    side.approvals += out.selfApprovals
    other.budget += out.opponentBudget
    other.approvals += out.opponentApprovals
    if (out.dropFrom) dropCandidate(state, side, out.dropFrom)

    if (card.sendsMarkerTo) state.marker = card.sendsMarkerTo
  }

  state.seatsTaken += 1
  refill(state)
  state.turn = actor === 0 ? 1 : 0
  return undo
}

export function undoHire(state: MatchState, undo: HireUndo): void {
  const side = state.sides[undo.actor]
  side.grid[undo.at.r]![undo.at.c] = null
  for (let i = 0; i < 2; i++) {
    state.sides[i]!.budget = undo.sides[i]!.budget
    state.sides[i]!.approvals = undo.sides[i]!.approvals
  }
  restorePiles(state, undo)
  state.marker = undo.marker
  state.turn = undo.turn
  state.seatsTaken = undo.seatsTaken
  state.rngState = undo.rngState
}

/** Apply both halves of a turn at once. */
export function applyTurn(state: MatchState, turn: Turn): Undo {
  const approval = applyApproval(state, turn.approval)
  const hire = applyHire(state, turn)
  return { approval, hire }
}

export function undoTurn(state: MatchState, undo: Undo): void {
  undoHire(state, undo.hire)
  undoApproval(state, undo.approval)
}

/**
 * Discard the last candidate showing on `floor` and take its printed cost as
 * budget.
 *
 * Always the last one, never a choice. Which of three candidates to bin is a
 * decision nobody enjoys making and everybody has to be asked about, and it
 * multiplied the branch count for a search that then had to justify the answer.
 * Fixed at the end of the row it is a rule a card can state in four words and a
 * player can see the consequence of before committing.
 */
function dropCandidate(state: MatchState, side: Side, floor: Floor): void {
  const list = state.shortlists[floor]
  const index = list.reduce((last, c, i) => (c ? i : last), -1)
  const card = index < 0 ? null : list[index]
  if (!card) return
  list[index] = null
  state.discards[floor].push(card)
  side.budget += card.cost
}

export const isOver = (state: MatchState): boolean =>
  state.seatsTaken >= SEAT_COUNT * 2

// Result

export interface SideResult {
  breakdown: ScoreBreakdown
  /** Budget that would not fit on a budget line. Breaks a tie on points. */
  loose: number
  grid: Cell[][]
}

export interface MatchResult {
  sides: [SideResult, SideResult]
  /** The winning player, or null when points and loose budget both tie. */
  winner: PlayerId | null
}

/**
 * Score one org as if the game ended now: crop to 3x3, pour leftover budget
 * into budget lines, then total it up. Filling greedily is optimal, so this
 * needs no input from the player.
 *
 * Also called on a partly built org, where the crop is provisional and position
 * bonuses may still move. The AI uses that as its board evaluation.
 */
export function settleSide(side: Side): SideResult {
  const grid = normalize(side.grid).map((row) =>
    row.map((cell) =>
      cell && isFilled(cell) ? { card: cell.card, budget: cell.budget } : cell,
    ),
  )
  const { funding, loose } = fillBudgetLinesAtEnd(grid, side.budget)
  for (const f of funding) {
    const cell = grid[f.r]![f.c]
    if (cell && isFilled(cell)) cell.budget += f.amount
  }
  return {
    breakdown: scoreOrg({ grid, approvals: side.approvals }),
    loose,
    grid,
  }
}

/** Settle both orgs and decide the winner. */
export function finish(state: MatchState): MatchResult {
  const settled = state.sides.map(settleSide) as [SideResult, SideResult]
  const [a, b] = settled
  let winner: PlayerId | null = null
  if (a.breakdown.total !== b.breakdown.total) {
    winner = a.breakdown.total > b.breakdown.total ? 0 : 1
  } else if (a.loose !== b.loose) {
    winner = a.loose > b.loose ? 0 : 1
  }
  return { sides: settled, winner }
}

export { isFilled, isOpenSeat }
