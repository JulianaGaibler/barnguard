// The computer opponent.
//
// Stargazer ships `searchBestMove`, a negamax searcher, but it does not fit.
// Office Overtime is almost perfect information (no hands, both orgs and both
// shortlists face up, budgets and approvals public) and the only hidden state is
// the order of the two draw piles. That is still a chance node, and negamax has
// nowhere to put one.
//
// Two things follow from the hidden draw order:
//
//   Refilling a shortlist deals unseen cards, so a search that just calls
//   `applyTurn` and looks at the result is reading the deck. That is invisible
//   at one ply, because the evaluation only reads the org, but any deeper search
//   would be cheating. Every ply past the first therefore runs on a
//   determinization: the unseen remainder of both decks is reshuffled, the
//   search runs on that, and the whole thing repeats over several samples whose
//   results are averaged. Deck composition is public (all 78 cards minus the
//   orgs, the shortlists and the face-up discard piles), so only the order needs
//   sampling.
//
//   Spending an approval to redraw is worth what the redraw is expected to
//   produce, which is the average over samples of the best hire available after
//   the deal. That needs the deal to happen before the hire is chosen, which is
//   why the redraw branch is planned in two phases rather than as one turn.
//
// The search itself is a beam: at the AI's own plies it keeps the best few
// candidates, at the opponent's plies it assumes the single best reply.

import {
  applyApproval,
  applyHire,
  bestHires,
  isOver,
  legalHires,
  undoApproval,
  undoHire,
  type ApprovalAction,
  type Hire,
  type MatchState,
  type PlayerId,
  type Turn,
} from './rules/match'
import { orgValue } from './evaluate'
import {
  AI_PROFILES,
  AI_SLICE_MS,
  type Difficulty,
  type SearchConfig,
} from './tuning'

export type Random = () => number

/**
 * The AI's decision for a turn.
 *
 * A redraw carries no hire: the cards it deals are not known yet, so the caller
 * applies the approval, then asks again with `planHire`.
 */
export type PlannedTurn =
  | { approval: 'none' | 'moveMarker'; hire: Hire }
  | { approval: 'refreshFloor'; hire: null }

/** Difficulties name a preset; a config can also be passed directly. */
const configOf = (d: Difficulty | SearchConfig): SearchConfig =>
  typeof d === 'string' ? AI_PROFILES[d] : d

const now = (): number =>
  typeof performance !== 'undefined' ? performance.now() : Date.now()

/** A small deterministic generator, for tests and reproducible matches. */
export function seededRandom(seed: number): Random {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 2 ** 32
  }
}

/**
 * How good this position is for `me`.
 *
 * `denial` blends the opponent's total in. At 0 the AI plays its own org and
 * ignores the other player; at 1 it treats a point denied as a point earned.
 */
function fitness(state: MatchState, me: PlayerId, cfg: SearchConfig): number {
  const mine = orgValue(state.sides[me], cfg.weights, cfg.expectedWindows)
  if (cfg.weights.denial === 0) return mine
  const theirs = orgValue(
    state.sides[me === 0 ? 1 : 0],
    cfg.weights,
    cfg.expectedWindows,
  )
  return mine + cfg.weights.denial * (mine - theirs)
}

type DeckOrder = {
  management: MatchState['decks']['management']
  ic: MatchState['decks']['ic']
}

/**
 * Reshuffle the unseen part of both decks and hand back the true order.
 *
 * Which cards remain is public: the deck is everything of that floor minus the
 * orgs, the shortlists and the face-up discard pile. Only the order is hidden,
 * so shuffling in place is exactly the uncertainty a player faces.
 */
function determinize(state: MatchState, random: Random): DeckOrder {
  const saved: DeckOrder = {
    management: state.decks.management.slice(),
    ic: state.decks.ic.slice(),
  }
  for (const floor of ['management', 'ic'] as const) {
    const deck = state.decks[floor]
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1))
      ;[deck[i], deck[j]] = [deck[j]!, deck[i]!]
    }
  }
  return saved
}

function restoreDecks(state: MatchState, saved: DeckOrder): void {
  state.decks.management = saved.management
  state.decks.ic = saved.ic
}

/** Value of a position after `me` has moved, searching `depthLeft` more plies. */
function search(
  state: MatchState,
  me: PlayerId,
  depthLeft: number,
  beam: readonly number[],
  beamIndex: number,
  cfg: SearchConfig,
  deadline: number,
): number {
  if (depthLeft <= 0 || isOver(state) || now() > deadline) {
    return fitness(state, me, cfg)
  }
  const mover = state.turn
  const hires = legalHires(state)
  if (hires.length === 0) return fitness(state, me, cfg)

  // Each side is ranked by what the position is worth to whoever is moving.
  // The AI follows its best few; the opponent is assumed to take their single
  // best reply, which keeps the tree from squaring at every pair of plies.
  const mine = mover === me
  const width = mine ? (beam[beamIndex] ?? 1) : 1
  const top = bestHires(state, hires, (s) => fitness(s, mover, cfg), width)

  let best = -Infinity
  for (const hire of top) {
    const undo = applyHire(state, hire)
    const value = search(
      state,
      me,
      depthLeft - 1,
      beam,
      mine ? beamIndex + 1 : beamIndex,
      cfg,
      deadline,
    )
    undoHire(state, undo)
    if (value > best) best = value
  }
  return best === -Infinity ? fitness(state, me, cfg) : best
}

interface Ranked {
  hire: Hire
  score: number
}

/** Rank the hires available right now, deep-searching the most promising ones. */
function* rankHires(
  state: MatchState,
  me: PlayerId,
  cfg: SearchConfig,
  random: Random,
  deadline: number,
): Generator<void, Ranked[], void> {
  const hires = legalHires(state)
  if (hires.length === 0) return []

  // One ply needs no determinization: the evaluation reads only the org, which
  // a refill cannot touch.
  const shallow: Ranked[] = []
  let slice = now() + AI_SLICE_MS
  for (const hire of hires) {
    const undo = applyHire(state, hire)
    shallow.push({ hire, score: fitness(state, me, cfg) })
    undoHire(state, undo)
    if (now() >= slice) {
      yield
      slice = now() + AI_SLICE_MS
    }
  }
  shallow.sort((a, b) => b.score - a.score)
  if (cfg.depth <= 1) return shallow

  const short = shallow.slice(0, cfg.beam[0] ?? shallow.length)
  const totals = new Map<Hire, number>(short.map((r) => [r.hire, 0]))
  let taken = 0
  for (let sample = 0; sample < cfg.samples; sample++) {
    if (now() > deadline) break
    const saved = determinize(state, random)
    for (const entry of short) {
      const undo = applyHire(state, entry.hire)
      const value = search(state, me, cfg.depth - 1, cfg.beam, 1, cfg, deadline)
      undoHire(state, undo)
      totals.set(entry.hire, (totals.get(entry.hire) ?? 0) + value)
      if (now() >= slice) {
        yield
        slice = now() + AI_SLICE_MS
      }
    }
    restoreDecks(state, saved)
    taken++
  }
  if (taken === 0) return shallow
  for (const entry of short) entry.score = (totals.get(entry.hire) ?? 0) / taken
  short.sort((a, b) => b.score - a.score)
  return short
}

/**
 * Choose a turn, yielding between slices of work.
 *
 * The approval step is decided first, because a redraw has to be committed
 * before the cards it deals can be seen. For the two known-information actions
 * the value is just the best hire that follows. For a redraw it is the average,
 * over sampled deals, of the best hire that follows, which is what makes it
 * comparable to the other two.
 */
/** What one approval action is worth, and the hire it leads to. */
export interface ActionScore {
  action: ApprovalAction
  score: number
  /** Null for a redraw: the cards it deals are not known yet. */
  hire: Hire | null
  /** Determinizations averaged. 1 for the actions with nothing hidden. */
  samples: number
}

/**
 * Value every approval action open to the player to move.
 *
 * The two known-information actions are worth the best hire that follows them.
 * A redraw is worth the average, over sampled deals, of the best hire that
 * follows, which is what makes it comparable: you commit the approval first and
 * only then see what you get.
 */
export function* scoreActions(
  state: MatchState,
  cfg: SearchConfig,
  random: Random,
  deadline: number,
): Generator<void, ActionScore[], void> {
  const me = state.turn
  const out: ActionScore[] = []

  const actions: ApprovalAction[] = ['none']
  if (state.sides[me].approvals >= 1) {
    actions.push('moveMarker')
    if (cfg.considerRedraw) actions.push('refreshFloor')
  }

  for (const action of actions) {
    if (action === 'refreshFloor') {
      let total = 0
      let taken = 0
      for (let sample = 0; sample < cfg.redrawSamples; sample++) {
        if (now() > deadline) break
        const saved = determinize(state, random)
        const undoA = applyApproval(state, action)
        const ranked = yield* rankHires(state, me, cfg, random, deadline)
        undoApproval(state, undoA)
        restoreDecks(state, saved)
        if (ranked.length > 0) {
          total += ranked[0]!.score
          taken++
        }
      }
      if (taken > 0) {
        out.push({ action, score: total / taken, hire: null, samples: taken })
      }
      continue
    }

    const undoA = applyApproval(state, action)
    const ranked = yield* rankHires(state, me, cfg, random, deadline)
    undoApproval(state, undoA)
    if (ranked.length === 0) continue
    const choice = pick(ranked, cfg.topChoices, random)
    out.push({ action, score: choice.score, hire: choice.hire, samples: 1 })
  }
  return out
}

/**
 * Choose a turn, yielding between slices of work.
 *
 * A redraw comes back without a hire attached: the caller applies the approval,
 * which deals the new row, and then asks again with `planHire`.
 */
export function* planTurn(
  state: MatchState,
  difficulty: Difficulty | SearchConfig,
  random: Random = Math.random,
): Generator<void, PlannedTurn | null, void> {
  const cfg = configOf(difficulty)
  const scored = yield* scoreActions(state, cfg, random, now() + cfg.budgetMs)
  if (scored.length === 0) return null
  scored.sort((a, b) => b.score - a.score)
  const best = scored[0]!
  if (best.action === 'refreshFloor')
    return { approval: 'refreshFloor', hire: null }
  if (!best.hire) return null
  return { approval: best.action as 'none' | 'moveMarker', hire: best.hire }
}

/** Choose the hire once the approval step has already been applied. */
export function* planHire(
  state: MatchState,
  difficulty: Difficulty | SearchConfig,
  random: Random = Math.random,
): Generator<void, Hire | null, void> {
  const cfg = configOf(difficulty)
  const deadline = now() + cfg.budgetMs
  const ranked = yield* rankHires(state, state.turn, cfg, random, deadline)
  if (ranked.length === 0) return null
  return pick(ranked, cfg.topChoices, random).hire
}

/** Take one of the best `topChoices` moves, breaking exact ties at random. */
function pick(ranked: Ranked[], topChoices: number, random: Random): Ranked {
  const width = Math.max(1, Math.min(topChoices, ranked.length))
  if (width > 1) return ranked[Math.floor(random() * width)]!
  const best = ranked[0]!.score
  const tied = ranked.filter((r) => r.score >= best - 1e-9)
  return tied[Math.floor(random() * tied.length)]!
}

const drain = <T>(gen: Generator<void, T, void>): T => {
  let step = gen.next()
  while (!step.done) step = gen.next()
  return step.value
}

/** Run the whole plan without yielding. */
export const chooseTurn = (
  state: MatchState,
  difficulty: Difficulty | SearchConfig,
  random: Random = Math.random,
): PlannedTurn | null => drain(planTurn(state, difficulty, random))

export const chooseHire = (
  state: MatchState,
  difficulty: Difficulty | SearchConfig,
  random: Random = Math.random,
): Hire | null => drain(planHire(state, difficulty, random))

/**
 * Plan and apply a whole computer turn.
 *
 * The two phases matter here: if the AI decides to redraw, the approval is
 * applied first so the new candidates are actually dealt, and only then is the
 * hire chosen. Returns the turn it played, or null if it had no legal move.
 */
export function takeAiTurn(
  state: MatchState,
  difficulty: Difficulty | SearchConfig,
  random: Random = Math.random,
): Turn | null {
  const planned = chooseTurn(state, difficulty, random)
  if (!planned) return null
  applyApproval(state, planned.approval)
  const hire = planned.hire ?? chooseHire(state, difficulty, random)
  if (!hire) return null
  applyHire(state, hire)
  return { approval: planned.approval, ...hire }
}
