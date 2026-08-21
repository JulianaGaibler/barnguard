import { describe, expect, it } from 'vitest'
import { chooseTurn, planTurn, seededRandom, takeAiTurn } from './ai'
import { DEFAULT_WEIGHTS } from './evaluate'
import {
  createMatch,
  finish,
  isOver,
  legalPlacements,
  legalTurns,
  seatsFilled,
  type MatchState,
} from './rules/match'
import { SEAT_COUNT } from './rules/scoring'
import { type Difficulty, type SearchConfig } from './tuning'

const DIFFICULTIES: Difficulty[] = ['easy', 'medium', 'hard']

/** Play a whole match with the computer on both sides. */
function autoPlay(seed: number, difficulty: Difficulty): MatchState {
  const state = createMatch(seed)
  const rng = seededRandom(seed ^ 0x5f3759df)
  let guard = 0
  while (!isOver(state)) {
    if (guard++ > 40) throw new Error('match did not terminate')
    const legal = legalPlacements(state.sides[state.turn].grid)
    const turn = takeAiTurn(state, difficulty, rng)
    expect(turn, `no turn at seat ${state.seatsTaken}`).not.toBeNull()
    // Whatever it picked has to be something the rules actually allow.
    expect(legal).toContainEqual(turn!.at)
  }
  return state
}

describe('chooseTurn', () => {
  it.each(DIFFICULTIES)('plays a legal full match on %s', (difficulty) => {
    const state = autoPlay(5, difficulty)
    expect(state.seatsTaken).toBe(SEAT_COUNT * 2)
    for (const side of state.sides) {
      expect(seatsFilled(side.grid)).toBe(SEAT_COUNT)
      expect(side.budget).toBeGreaterThanOrEqual(0)
    }
    const result = finish(state)
    for (const side of result.sides) {
      expect(side.grid.flat().filter((c) => c !== null)).toHaveLength(9)
    }
  })

  it('is reproducible from a seed', () => {
    const a = finish(autoPlay(99, 'medium'))
    const b = finish(autoPlay(99, 'medium'))
    expect(a.sides.map((s) => s.breakdown.total)).toEqual(
      b.sides.map((s) => s.breakdown.total),
    )
  })

  // Rerolling is genuinely strong here: the showing row is picked over, so a
  // fresh deal beats it more often than the approval costs. Easy cannot model
  // an unseen deal, so it never rerolls; the stronger levels do.
  it('never rerolls on easy', () => {
    const state = createMatch(3)
    const rng = seededRandom(1)
    while (!isOver(state)) {
      expect(takeAiTurn(state, 'easy', rng)!.approval).not.toBe('refreshFloor')
    }
  })

  it('leaves the match state untouched while searching', () => {
    const state = createMatch(64)
    const snap = JSON.stringify({
      budgets: state.sides.map((s) => s.budget),
      approvals: state.sides.map((s) => s.approvals),
      seats: state.sides.map((s) => seatsFilled(s.grid)),
      marker: state.marker,
      turn: state.turn,
      deck: state.decks.ic.length,
      rng: state.rngState,
    })
    chooseTurn(state, 'hard', seededRandom(2))
    expect(
      JSON.stringify({
        budgets: state.sides.map((s) => s.budget),
        approvals: state.sides.map((s) => s.approvals),
        seats: state.sides.map((s) => seatsFilled(s.grid)),
        marker: state.marker,
        turn: state.turn,
        deck: state.decks.ic.length,
        rng: state.rngState,
      }),
    ).toBe(snap)
  })

  it('returns null only when there is nothing to do', () => {
    const state = createMatch(8)
    expect(legalTurns(state).length).toBeGreaterThan(0)
    expect(chooseTurn(state, 'medium', seededRandom(4))).not.toBeNull()
  })
})

describe('planTurn slicing', () => {
  it('drains to the same decision as the blocking call', () => {
    const state = createMatch(15)
    const plan = planTurn(state, 'hard', seededRandom(6))
    let step = plan.next()
    let slices = 0
    while (!step.done) {
      slices++
      step = plan.next()
      expect(slices).toBeLessThan(100_000)
    }
    expect(step.value).toEqual(chooseTurn(state, 'hard', seededRandom(6)))
  })
})

describe('difficulty ordering', () => {
  // Win counts are far too noisy to assert on at a sample size a unit test can
  // afford: a 63% edge needs about a hundred games to show reliably. Average
  // score margin over paired seeds converges much faster, so that is the check.
  // The shipped profiles are measured separately in docs/rules-and-ai.md.
  function margin(a: Difficulty | SearchConfig, b: Difficulty | SearchConfig) {
    const seeds = Array.from({ length: 14 }, (_, i) => i * 17 + 1)
    let total = 0
    for (const seed of seeds) {
      for (const swap of [false, true]) {
        const state = createMatch(seed)
        const rng = seededRandom(seed)
        while (!isOver(state)) {
          const lvl = (swap ? state.turn === 1 : state.turn === 0) ? a : b
          takeAiTurn(state, lvl, rng)
        }
        const r = finish(state)
        const aSide = swap ? 1 : 0
        total +=
          r.sides[aSide]!.breakdown.total - r.sides[1 - aSide]!.breakdown.total
      }
    }
    return total / (seeds.length * 2)
  }

  it('has medium outscore easy', () => {
    expect(margin('medium', 'easy')).toBeGreaterThan(1)
  }, 60_000)

  // Cheaper stand-ins for hard and medium: the capability that separates them
  // is whether an approval may be spent to redeal, not the search budget.
  const lean: SearchConfig = {
    depth: 2,
    beam: [6],
    samples: 1,
    redrawSamples: 6,
    considerRedraw: false,
    expectedWindows: true,
    topChoices: 1,
    budgetMs: 60_000,
    weights: DEFAULT_WEIGHTS,
  }

  it('has redealing outscore not redealing', () => {
    expect(margin({ ...lean, considerRedraw: true }, lean)).toBeGreaterThan(0.5)
  }, 60_000)
})
