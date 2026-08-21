// The numeric expectations here are taken from the reference implementation the
// deck was transcribed from, so they pin the port rather than the port's own
// idea of what it does.

import { describe, expect, it } from 'vitest'
import { DECK_BY_ID } from './deck'
import {
  countMetric,
  orgScope,
  scoreOrg,
  type Cell,
  type Grid,
  type Player,
  type Pos,
} from './scoring'

const seat = (id: string, budget = 0): Cell => {
  const card = DECK_BY_ID.get(id)
  if (!card) throw new Error(`unknown card: ${id}`)
  return { card, budget }
}

const emptyGrid = (): Cell[][] => [
  [null, null, null],
  [null, null, null],
  [null, null, null],
]

/** A one-card org, that card at `pos` (centre by default). */
const solo = (
  id: string,
  opts: { budget?: number; pos?: Pos; approvals?: number } = {},
): Player => {
  const grid = emptyGrid()
  const { r, c } = opts.pos ?? { r: 1, c: 1 }
  grid[r]![c] = seat(id, opts.budget)
  return { grid, approvals: opts.approvals ?? 0 }
}

const of = (grid: Grid, approvals = 0): Player => ({ grid, approvals })

describe('budget lines', () => {
  it('pays 2 per dollar up to the cap', () => {
    expect(
      scoreOrg(solo('ic-technical-program-manager', { budget: 3 })).total,
    ).toBe(6)
  })

  it('ignores dollars past the cap', () => {
    expect(
      scoreOrg(solo('ic-technical-program-manager', { budget: 9 })).total,
    ).toBe(8)
  })
})

describe('per-metric scoring', () => {
  it('counts the scoring card own group', () => {
    // Chief Operating Officer: 4 per Leadership shield in its row, itself included.
    expect(scoreOrg(solo('mgmt-chief-operating-officer')).total).toBe(4)
  })

  it('adds one point per approval held', () => {
    expect(
      scoreOrg(solo('mgmt-chief-operating-officer', { approvals: 5 })).total,
    ).toBe(9)
  })

  it('counts a set as the smaller of its two halves', () => {
    // Product Operations Manager: 4 per Leadership+Product pair. One Leadership
    // and two Product shields make exactly one pair.
    const grid = emptyGrid()
    grid[1]![1] = seat('mgmt-product-operations-manager') // product
    grid[0]![0] = seat('mgmt-board-member') // leadership x2 -> 1 card, 2 shields
    grid[0]![1] = seat('mgmt-principal-product-manager') // product
    const total = scoreOrg(of(grid)).seats.find(
      (s) => s.kind === 'card' && s.id === 'mgmt-product-operations-manager',
    )
    expect(total?.points).toBe(8)
  })

  it('counts discount cards', () => {
    const grid = emptyGrid()
    grid[1]![1] = seat('mgmt-head-of-business-analytics') // itself a discount card
    grid[0]![0] = seat('mgmt-chief-technical-officer')
    grid[0]![1] = seat('mgmt-vp-public-relations')
    const s = scoreOrg(of(grid)).seats.find(
      (x) => x.kind === 'card' && x.id === 'mgmt-head-of-business-analytics',
    )
    expect(s?.points).toBe(12)
  })
})

describe('position bonuses', () => {
  it('pays in the required area', () => {
    expect(
      scoreOrg(solo('mgmt-board-member', { pos: { r: 0, c: 0 } })).total,
    ).toBe(8)
  })

  it('pays nothing elsewhere', () => {
    expect(
      scoreOrg(solo('mgmt-board-member', { pos: { r: 2, c: 0 } })).total,
    ).toBe(0)
  })

  it('treats the four edge midpoints as edge centres', () => {
    const centres: Pos[] = [
      { r: 0, c: 1 },
      { r: 1, c: 0 },
      { r: 1, c: 2 },
      { r: 2, c: 1 },
    ]
    for (const pos of centres) {
      expect(
        scoreOrg(solo('ic-content-designer', { pos })).total,
        `${pos.r},${pos.c}`,
      ).toBe(3)
    }
    // The middle of the org is not an edge centre.
    expect(
      scoreOrg(solo('ic-content-designer', { pos: { r: 1, c: 1 } })).total,
    ).toBe(0)
  })
})

describe('regions', () => {
  it('counts a rowOrColumn card once, not twice', () => {
    // UX Lead scores per Design shield in its row; a five-cell rowOrColumn scope
    // must not double-count the scoring seat itself.
    const grid = emptyGrid()
    grid[1]![1] = seat('ic-ux-lead')
    const scope = orgScope(of(grid))
    expect(countMetric({ count: 'group', group: 'design' }, scope)).toBe(1)
  })
})

describe('open seats', () => {
  const openSeat = (): Cell => ({ openSeat: true })

  it('contribute no groups, no floor and no discount', () => {
    const grid = emptyGrid()
    grid[0]![0] = openSeat()
    grid[1]![1] = seat('mgmt-vp-of-data-and-research') // 2 per Management ribbon
    // Only the VP itself is a Management card. The open seat is not.
    const s = scoreOrg(of(grid)).seats.find(
      (x) => x.kind === 'card' && x.id === 'mgmt-vp-of-data-and-research',
    )
    expect(s?.points).toBe(2)
  })

  it('score nothing themselves but still fill a seat', () => {
    const grid = emptyGrid()
    grid[0]![0] = openSeat()
    const breakdown = scoreOrg(of(grid))
    expect(breakdown.total).toBe(0)
    expect(breakdown.seats.filter((s) => s.kind === 'openSeat')).toHaveLength(1)
    expect(breakdown.seats).toHaveLength(9)
  })
})

describe('seat arithmetic', () => {
  // Abilities that pay per empty seat must count against the nine seats an org
  // has, not against the size of the backing array.
  it('counts empty seats against nine regardless of grid width', () => {
    const wide: Cell[][] = Array.from({ length: 5 }, () =>
      Array.from({ length: 5 }, () => null as Cell),
    )
    wide[2]![2] = seat('mgmt-culture-engagement-manager')
    const scope = orgScope(of(wide))
    expect(countMetric({ count: 'emptySeats' }, scope)).toBe(8)
    expect(countMetric({ count: 'filledSeats' }, scope)).toBe(1)
  })

  it('counts open seats as filled', () => {
    const grid = emptyGrid()
    grid[0]![0] = { openSeat: true }
    grid[0]![1] = seat('mgmt-board-member')
    const scope = orgScope(of(grid))
    expect(countMetric({ count: 'filledSeats' }, scope)).toBe(2)
    expect(countMetric({ count: 'emptySeats' }, scope)).toBe(7)
  })
})

describe('runs of identical groups', () => {
  it('pays per three matching shields, summed over groups', () => {
    // Head of Product: 6 per run of three identical group shields.
    const grid = emptyGrid()
    grid[1]![1] = seat('mgmt-head-of-product') // product
    grid[0]![0] = seat('mgmt-principal-product-manager') // product
    grid[0]![1] = seat('mgmt-director-of-product-management') // product
    const s = scoreOrg(of(grid)).seats.find(
      (x) => x.kind === 'card' && x.id === 'mgmt-head-of-product',
    )
    expect(s?.points).toBe(6)
  })
})
