import { describe, expect, it } from 'vitest'
import { DECK_BY_ID } from './deck'
import {
  applyTurn,
  candidateFor,
  createMatch,
  finish,
  isOver,
  legalPlacements,
  legalTurns,
  normalize,
  seatsFilled,
  undoTurn,
  WORKING,
  type MatchState,
  type Turn,
} from './match'
import { effectiveCost } from './economy'
import { SEAT_COUNT, type Cell } from './scoring'

const grid = (): Cell[][] =>
  Array.from({ length: WORKING }, () =>
    Array.from({ length: WORKING }, () => null as Cell),
  )
const seat = (id = 'mgmt-ceo'): Cell => ({
  card: DECK_BY_ID.get(id)!,
  budget: 0,
})
const at = (g: Cell[][], r: number, c: number) => {
  g[r]![c] = seat()
  return g
}

describe('placement', () => {
  it('pins the first card to the centre', () => {
    expect(legalPlacements(grid())).toEqual([{ r: 2, c: 2 }])
  })

  it('offers only orthogonal neighbours', () => {
    const g = at(grid(), 2, 2)
    expect(legalPlacements(g).sort((a, b) => a.r - b.r || a.c - b.c)).toEqual([
      { r: 1, c: 2 },
      { r: 2, c: 1 },
      { r: 2, c: 3 },
      { r: 3, c: 2 },
    ])
  })

  it('lets the org grow up and left from the first card', () => {
    // The reason the working grid is 5x5: from the centre, a 3x3 org can still
    // end up anywhere around the opening card.
    const g = at(grid(), 2, 2)
    const spots = legalPlacements(g)
    expect(spots).toContainEqual({ r: 1, c: 2 })
    expect(spots).toContainEqual({ r: 2, c: 1 })
  })

  // Two cards two apart fix that axis of the bounding box for the rest of the game.
  it('closes an axis once the bounding box spans three', () => {
    const g = grid()
    g[2]![2] = seat()
    g[2]![3] = seat()
    g[2]![4] = seat()
    const cols = new Set(legalPlacements(g).map((p) => p.c))
    expect(cols.has(1)).toBe(false)
    expect(cols.has(5)).toBe(false)
    expect([...cols].sort()).toEqual([2, 3, 4])
  })

  it('never offers a placement that would make a 4-wide org', () => {
    const g = grid()
    g[2]![2] = seat()
    g[2]![4] = seat()
    g[2]![3] = seat()
    for (const p of legalPlacements(g)) {
      g[p.r]![p.c] = seat()
      const cs = g
        .flatMap((row) => row.map((cell, c) => (cell ? c : -1)))
        .filter((c) => c >= 0)
      expect(Math.max(...cs) - Math.min(...cs)).toBeLessThanOrEqual(2)
      g[p.r]![p.c] = null
    }
  })
})

describe('normalize', () => {
  it('crops a full org to its 3x3 bounding box', () => {
    const g = grid()
    for (let r = 1; r <= 3; r++) for (let c = 2; c <= 4; c++) g[r]![c] = seat()
    const n = normalize(g)
    expect(n).toHaveLength(3)
    expect(
      n.every((row) => row.length === 3 && row.every((x) => x !== null)),
    ).toBe(true)
  })
})

// Drives a whole match by always taking the first legal turn.
function playOut(state: MatchState, pick: (turns: Turn[]) => Turn): void {
  let guard = 0
  while (!isOver(state)) {
    if (guard++ > 100) throw new Error('match did not terminate')
    const turns = legalTurns(state)
    expect(
      turns.length,
      `no legal turn at seat ${state.seatsTaken}`,
    ).toBeGreaterThan(0)
    applyTurn(state, pick(turns))
  }
}

describe('a full match', () => {
  it('fills both orgs to nine seats in eighteen turns', () => {
    const state = createMatch(7)
    playOut(state, (t) => t[0]!)
    expect(state.seatsTaken).toBe(SEAT_COUNT * 2)
    for (const side of state.sides)
      expect(seatsFilled(side.grid)).toBe(SEAT_COUNT)
  })

  it('alternates turns', () => {
    const state = createMatch(11)
    const first = state.turn
    applyTurn(state, legalTurns(state)[0]!)
    expect(state.turn).toBe(first === 0 ? 1 : 0)
  })

  it('produces a full 3x3 for both sides and a decided result', () => {
    for (const seed of [1, 2, 3, 42, 999]) {
      const state = createMatch(seed)
      playOut(state, (t) => t[t.length - 1]!)
      const result = finish(state)
      for (const side of result.sides) {
        expect(side.grid.flat().filter((c) => c !== null)).toHaveLength(9)
        expect(side.breakdown.seats).toHaveLength(9)
        expect(Number.isFinite(side.breakdown.total)).toBe(true)
      }
      const [a, b] = result.sides
      if (a.breakdown.total > b.breakdown.total) expect(result.winner).toBe(0)
      if (b.breakdown.total > a.breakdown.total) expect(result.winner).toBe(1)
    }
  })

  it('never lets a player spend below zero budget', () => {
    for (const seed of [4, 5, 6]) {
      const state = createMatch(seed)
      while (!isOver(state)) {
        applyTurn(state, legalTurns(state)[0]!)
        for (const side of state.sides)
          expect(side.budget).toBeGreaterThanOrEqual(0)
      }
    }
  })

  it('keeps the shortlists topped up', () => {
    const state = createMatch(21)
    while (!isOver(state)) {
      applyTurn(state, legalTurns(state)[0]!)
      for (const floor of ['management', 'ic'] as const) {
        expect(state.shortlists[floor].filter(Boolean).length).toBe(3)
      }
    }
  })
})

// The whole reason `Undo` snapshots the deck arrays and the random state.
function snapshot(state: MatchState): string {
  return JSON.stringify({
    sides: state.sides.map((s) => ({
      budget: s.budget,
      approvals: s.approvals,
      grid: s.grid.map((row) =>
        row.map((cell) =>
          cell === null
            ? null
            : 'openSeat' in cell
              ? 'open'
              : [cell.card.id, cell.budget],
        ),
      ),
    })),
    decks: {
      management: state.decks.management.map((c) => c.id),
      ic: state.decks.ic.map((c) => c.id),
    },
    discards: {
      management: state.discards.management.map((c) => c.id),
      ic: state.discards.ic.map((c) => c.id),
    },
    shortlists: {
      management: state.shortlists.management.map((c) => c?.id ?? null),
      ic: state.shortlists.ic.map((c) => c?.id ?? null),
    },
    marker: state.marker,
    turn: state.turn,
    seatsTaken: state.seatsTaken,
    rngState: state.rngState,
  })
}

describe('undo', () => {
  it('restores the state exactly, turn after turn', () => {
    const state = createMatch(31)
    while (!isOver(state)) {
      const turns = legalTurns(state)
      const before = snapshot(state)
      for (const turn of turns.slice(0, 12)) {
        const undo = applyTurn(state, turn)
        undoTurn(state, undo)
        expect(snapshot(state)).toBe(before)
      }
      applyTurn(state, turns[0]!)
    }
  })

  it('is exact across a reshuffle', () => {
    // Force the reshuffle by starving a deck, so the refill has to fold the
    // discard pile back in and reorder it.
    const state = createMatch(77)
    state.discards.ic = state.decks.ic.splice(0, state.decks.ic.length - 1)
    const before = snapshot(state)
    const turn = legalTurns(state).find((t) => t.approval === 'refreshFloor')
    expect(turn, 'expected a refresh turn to be available').toBeDefined()
    const undo = applyTurn(state, turn!)
    expect(snapshot(state)).not.toBe(before)
    undoTurn(state, undo)
    expect(snapshot(state)).toBe(before)
  })

  it('re-applying a turn after undo deals the same cards', () => {
    const state = createMatch(52)
    const turn = legalTurns(state)[3]!
    const undo1 = applyTurn(state, turn)
    const after = snapshot(state)
    undoTurn(state, undo1)
    applyTurn(state, turn)
    expect(snapshot(state)).toBe(after)
  })
})

describe('open seats', () => {
  it('pay budget and approvals instead of costing anything', () => {
    const state = createMatch(13)
    const side = state.sides[state.turn]
    const budget = side.budget
    const approvals = side.approvals
    const turn = legalTurns(state).find(
      (t) => t.take === 'openSeat' && t.approval === 'none',
    )!
    applyTurn(state, turn)
    expect(side.budget).toBe(budget + 6)
    expect(side.approvals).toBe(approvals + 2)
  })

  it('never move the floor marker', () => {
    const state = createMatch(17)
    const marker = state.marker
    const turn = legalTurns(state).find(
      (t) => t.take === 'openSeat' && t.approval === 'none',
    )!
    applyTurn(state, turn)
    expect(state.marker).toBe(marker)
  })

  it('can take a candidate the player could not afford', () => {
    const state = createMatch(23)
    const side = state.sides[state.turn]
    side.budget = 0
    const turns = legalTurns(state)
    // Every showing candidate is still available as an open seat.
    expect(turns.some((t) => t.take === 'openSeat')).toBe(true)
    // But nothing with a real price is hirable. Free cards still are, and a
    // refresh deals cards nobody has seen yet, so both are excluded here.
    const overpriced = turns.filter(
      (t) =>
        t.take === 'hire' &&
        t.approval !== 'refreshFloor' &&
        effectiveCost(candidateFor(state, t)!, side.grid) > 0,
    )
    expect(overpriced).toEqual([])
  })
})

describe('approval actions', () => {
  it('moving the marker costs one approval and flips the floor', () => {
    const state = createMatch(29)
    const side = state.sides[state.turn]
    const approvals = side.approvals
    const marker = state.marker
    const turn = legalTurns(state).find(
      (t) => t.approval === 'moveMarker' && t.take === 'openSeat',
    )!
    applyTurn(state, turn)
    // The open seat also pays two approvals back.
    expect(side.approvals).toBe(approvals - 1 + 2)
    expect(state.marker).not.toBe(marker)
  })

  it('is unavailable with no approvals left', () => {
    const state = createMatch(37)
    state.sides[state.turn]!.approvals = 0
    expect(legalTurns(state).every((t) => t.approval === 'none')).toBe(true)
  })

  it('refreshing sends the whole showing row to the discard pile', () => {
    const state = createMatch(41)
    const floor = state.marker
    const before = state.shortlists[floor].map((c) => c!.id)
    expect(before).toHaveLength(3)
    const turn = legalTurns(state).find(
      (t) => t.approval === 'refreshFloor' && t.take === 'openSeat',
    )!
    applyTurn(state, turn)
    const discarded = new Set(state.discards[floor].map((c) => c.id))
    for (const id of before) expect(discarded.has(id), id).toBe(true)
    // And the row is showing three cards again.
    expect(state.shortlists[floor].filter(Boolean)).toHaveLength(3)
  })
})
