// The Quick (2x2) board: the width seam, the scoring resolver, and a full
// four-hire match. Standard-board behaviour is covered by the other suites; this
// one pins what changes when `width` is 2.

import { describe, expect, it } from 'vitest'
import { DECK_BY_ID } from './deck'
import {
  applyTurn,
  createMatch,
  finish,
  isOver,
  legalPlacements,
  legalTurns,
  normalize,
  seatsFilled,
  type MatchState,
  type Turn,
} from './match'
import { resolveScoring, scoreOrg, type Cell, type FilledSeat } from './scoring'
import { describeScoring } from './text'

const seat = (id: string): FilledSeat => ({
  card: DECK_BY_ID.get(id)!,
  budget: 0,
})

function playOut(state: MatchState, pick: (turns: Turn[]) => Turn): void {
  let guard = 0
  while (!isOver(state)) {
    if (guard++ > 100) throw new Error('quick match did not terminate')
    const turns = legalTurns(state)
    expect(turns.length).toBeGreaterThan(0)
    applyTurn(state, pick(turns))
  }
}

describe('the quick board', () => {
  it('starts a 2x2 match on a 3x3 working grid', () => {
    const state = createMatch(7, 2)
    expect(state.width).toBe(2)
    expect(state.sides[0].grid.length).toBe(3)
    // Scaled starting purse, not the standard 15.
    expect(state.sides[0].budget).toBe(7)
  })

  it('pins the first card to the centre of its working grid', () => {
    expect(legalPlacements(state2Grid(), 2)).toEqual([{ r: 1, c: 1 }])
  })

  it('never lets the org grow past a 2x2 box', () => {
    const g = state2Grid()
    g[1]![1] = seat('mgmt-ceo')
    g[1]![2] = seat('mgmt-ceo')
    for (const p of legalPlacements(g, 2)) {
      g[p.r]![p.c] = seat('mgmt-ceo')
      const cols = g
        .flatMap((row) => row.map((cell, c) => (cell ? c : -1)))
        .filter((c) => c >= 0)
      expect(Math.max(...cols) - Math.min(...cols)).toBeLessThanOrEqual(1)
      g[p.r]![p.c] = null
    }
  })

  it('fills both orgs to four seats in eight turns', () => {
    const state = createMatch(7, 2)
    playOut(state, (t) => t[0]!)
    expect(state.seatsTaken).toBe(8)
    for (const side of state.sides) expect(seatsFilled(side.grid)).toBe(4)
  })

  it('produces a full 2x2 and a decided result across seeds', () => {
    for (const seed of [1, 2, 3, 42, 999]) {
      const state = createMatch(seed, 2)
      playOut(state, (t) => t[0]!)
      const result = finish(state)
      for (const side of result.sides) {
        expect(side.grid).toHaveLength(2)
        expect(side.grid.every((row) => row.length === 2)).toBe(true)
        expect(side.breakdown.seats).toHaveLength(4)
      }
      expect(
        result.winner === null || result.winner === 0 || result.winner === 1,
      ).toBe(true)
    }
  })

  it('normalizes a full working grid down to 2x2', () => {
    const g = state2Grid()
    for (let r = 1; r <= 2; r++)
      for (let c = 1; c <= 2; c++) g[r]![c] = seat('mgmt-ceo')
    const n = normalize(g, 2)
    expect(n).toHaveLength(2)
    expect(
      n.every((row) => row.length === 2 && row.every((x) => x !== null)),
    ).toBe(true)
  })
})

describe('the scoring resolver', () => {
  it('leaves standard scoring untouched at width 3', () => {
    const card = DECK_BY_ID.get('mgmt-head-of-product')!
    expect(resolveScoring(card, 3)).toBe(card.scoring)
  })

  it('shrinks a size-3 run or set to size 2 on the quick board', () => {
    const set = resolveScoring(DECK_BY_ID.get('mgmt-head-of-product')!, 2)
    expect(set.score === 'perMatchingGroupSet' && set.size).toBe(2)
    const run = resolveScoring(DECK_BY_ID.get('ic-design-systems-designer')!, 2)
    expect(run.score === 'perRun' && run.size).toBe(2)
  })

  it('remaps a 3x3 position bonus to a single corner', () => {
    // Board Member scores in the top row on 3x3; a 2x2 has no row to reward, so
    // it becomes the top-left corner.
    const rule = resolveScoring(DECK_BY_ID.get('mgmt-board-member')!, 2)
    expect(
      rule.score === 'bonus' && rule.when.when === 'inArea' && rule.when.area,
    ).toBe('topLeft')
  })

  it('shows the shrunk size in the card text', () => {
    expect(
      describeScoring(DECK_BY_ID.get('mgmt-head-of-product')!, 2),
    ).toContain('2')
  })
})

describe('a corner bonus on the quick board', () => {
  const org = (pos: { r: number; c: number }): Cell[][] => {
    const g: Cell[][] = [
      [seat('mgmt-ceo'), seat('mgmt-ceo')],
      [seat('mgmt-ceo'), seat('mgmt-ceo')],
    ]
    g[pos.r]![pos.c] = seat('mgmt-board-member')
    return g
  }
  const boardMemberPoints = (g: Cell[][]): number => {
    const scored = scoreOrg({ grid: g, approvals: 0, width: 2 })
    const cell = scored.seats.find(
      (s) => s.kind === 'card' && s.id === 'mgmt-board-member',
    )
    return cell?.points ?? 0
  }

  it('scores in its corner and nowhere else', () => {
    const inCorner = boardMemberPoints(org({ r: 0, c: 0 }))
    const elsewhere = boardMemberPoints(org({ r: 1, c: 1 }))
    expect(inCorner).toBeGreaterThan(0)
    expect(elsewhere).toBe(0)
  })
})

/** A blank 3x3 working grid (the Quick board's coordinate space). */
function state2Grid(): Cell[][] {
  return Array.from({ length: 3 }, () =>
    Array.from({ length: 3 }, () => null as Cell),
  )
}
