import { describe, expect, it } from 'vitest'
import { DECK, DECK_BY_ID, type Card } from './deck'
import {
  budgetLineSeats,
  choiceCount,
  effectiveCost,
  fillBudgetLinesAtEnd,
  resolveAbility,
} from './economy'
import { type Cell, type Player } from './scoring'

const card = (id: string): Card => {
  const c = DECK_BY_ID.get(id)
  if (!c) throw new Error(`unknown card: ${id}`)
  return c
}
const seat = (id: string, budget = 0): Cell => ({ card: card(id), budget })
const grid3 = (): Cell[][] => [
  [null, null, null],
  [null, null, null],
  [null, null, null],
]
const player = (grid: Cell[][], approvals = 0): Player => ({ grid, approvals })
const empty = (): Player => player(grid3())

describe('effectiveCost', () => {
  const clerk = card('mgmt-mailroom-clerk') // $7 Management

  it('is the printed cost with an empty org', () => {
    expect(effectiveCost(clerk, grid3())).toBe(7)
  })

  it('stacks discounts of the matching floor', () => {
    const g = grid3()
    g[0]![0] = seat('mgmt-vp-public-relations') // -1 management
    g[0]![1] = seat('mgmt-chief-marketing-officer') // -1 all
    expect(effectiveCost(clerk, g)).toBe(5)
  })

  it('ignores discounts scoped to the other floor', () => {
    const g = grid3()
    g[0]![0] = seat('mgmt-research-operations-manager') // -1 ic
    expect(effectiveCost(clerk, g)).toBe(7)
  })

  it('never goes below zero and never refunds', () => {
    const g = grid3()
    g[0]![0] = seat('mgmt-chief-marketing-officer') // -1 all
    g[0]![1] = seat('mgmt-vp-public-relations') // -1 management
    g[0]![2] = seat('mgmt-chief-technical-officer') // -1 management
    const free = card('mgmt-chief-financial-officer') // $0
    expect(effectiveCost(free, g)).toBe(0)
  })

  // A card is priced before it is placed, so its own discount cannot apply to
  // the purchase that acquires it.
  it('does not let a discount card discount itself', () => {
    const alchemist = card('mgmt-head-of-business-analytics') // $6, -1 all
    expect(effectiveCost(alchemist, grid3())).toBe(6)
  })

  // An open seat has no card face up, so its discount is inert.
  it('ignores a discount card left as an open seat', () => {
    const g = grid3()
    g[0]![0] = { openSeat: true }
    expect(effectiveCost(clerk, g)).toBe(7)
  })
})

describe('resolveAbility', () => {
  it('pays a flat gain', () => {
    // Head of Product Strategy: gain 2 approvals.
    const g = grid3()
    g[0]![0] = seat('mgmt-head-of-product-strategy')
    const out = resolveAbility(
      card('mgmt-head-of-product-strategy'),
      player(g),
      empty(),
    )
    expect(out.selfApprovals).toBe(2)
    expect(out.selfBudget).toBe(0)
  })

  it('counts the triggering card itself', () => {
    // Chief Operating Officer: 1 budget per Leadership shield, itself included.
    const g = grid3()
    g[1]![1] = seat('mgmt-chief-operating-officer')
    const out = resolveAbility(
      card('mgmt-chief-operating-officer'),
      player(g),
      empty(),
    )
    expect(out.selfBudget).toBe(1)
  })

  it('reads the opponent org for an opponent-scoped ability', () => {
    // Design Systems Designer: 1 approval per Management card of the opponent.
    const mine = grid3()
    mine[1]![1] = seat('ic-design-systems-designer')
    const theirs = grid3()
    theirs[0]![0] = seat('mgmt-ceo')
    theirs[0]![1] = seat('mgmt-board-member')
    const out = resolveAbility(
      card('ic-design-systems-designer'),
      player(mine),
      player(theirs),
    )
    expect(out.selfApprovals).toBe(2)
  })

  it('pays the opponent without paying the actor', () => {
    // Board Member: the opponent gains 1 budget.
    const g = grid3()
    g[0]![0] = seat('mgmt-board-member')
    const out = resolveAbility(card('mgmt-board-member'), player(g), empty())
    expect(out.opponentBudget).toBe(1)
    expect(out.selfBudget).toBe(0)
  })

  it('pays the actor too when everyone gains', () => {
    // Chief of Staff: all players, the actor included, gain 1 approval.
    const g = grid3()
    g[0]![0] = seat('mgmt-chief-of-staff')
    const out = resolveAbility(card('mgmt-chief-of-staff'), player(g), empty())
    expect(out.selfApprovals).toBe(1)
    expect(out.opponentApprovals).toBe(1)
  })

  it('takes the picked branch of a choice', () => {
    // Head of IT Infrastructure: fund every budget line by 2, or gain 3 approvals.
    const g = grid3()
    g[0]![0] = seat('mgmt-head-of-it-infrastructure')
    g[0]![1] = seat('ic-icon-designer') // cap 9 budget line
    const c = card('mgmt-head-of-it-infrastructure')
    expect(choiceCount(c)).toBe(1)

    const funded = resolveAbility(c, player(g), empty(), [0])
    expect(funded.funding).toEqual([{ r: 0, c: 1, amount: 2 }])
    expect(funded.selfApprovals).toBe(0)

    const approvals = resolveAbility(c, player(g), empty(), [1])
    expect(approvals.selfApprovals).toBe(3)
    expect(approvals.funding).toEqual([])
  })

  it('reports the floor a candidate must be dropped from', () => {
    // Sunset Program Manager drops a Management candidate.
    const g = grid3()
    g[0]![0] = seat('ic-sunset-program-manager')
    const out = resolveAbility(
      card('ic-sunset-program-manager'),
      player(g),
      empty(),
    )
    expect(out.dropFrom).toBe('management')
  })

  it('resolves both effects of a two-effect card', () => {
    // Content Designer: 1 budget per Design shield, plus 1 approval per IC ribbon.
    const g = grid3()
    g[0]![0] = seat('ic-content-designer') // design, IC
    g[0]![1] = seat('ic-ux-lead') // design, IC
    const out = resolveAbility(card('ic-content-designer'), player(g), empty())
    expect(out.selfBudget).toBe(2)
    expect(out.selfApprovals).toBe(2)
  })
})

describe('funding budget lines', () => {
  it('fills the fullest-capacity lines when the target is a count', () => {
    // Chief Financial Officer fills two budget lines to full.
    const g = grid3()
    g[0]![0] = seat('mgmt-chief-financial-officer') // cap 3, itself a line
    g[0]![1] = seat('ic-icon-designer') // cap 9
    g[0]![2] = seat('ic-technical-program-manager') // cap 4
    const out = resolveAbility(
      card('mgmt-chief-financial-officer'),
      player(g),
      empty(),
    )
    const total = out.funding.reduce((n, f) => n + f.amount, 0)
    expect(total).toBe(13) // 9 + 4, leaving the cap-3 line alone
    expect(out.funding.map((f) => f.c).sort()).toEqual([1, 2])
  })

  it('respects remaining capacity rather than the cap', () => {
    const g = grid3()
    g[0]![0] = seat('ic-icon-designer', 7) // cap 9, already holds 7
    expect(budgetLineSeats(g)).toEqual([{ r: 0, c: 0, remaining: 2 }])
  })

  it('skips lines that are already full', () => {
    const g = grid3()
    g[0]![0] = seat('mgmt-head-of-it-infrastructure')
    g[0]![1] = seat('ic-technical-program-manager', 4) // cap 4, full
    const out = resolveAbility(
      card('mgmt-head-of-it-infrastructure'),
      player(g),
      empty(),
      [0],
    )
    expect(out.funding).toEqual([])
  })
})

describe('fillBudgetLinesAtEnd', () => {
  it('stores what fits and leaves the rest loose', () => {
    const g = grid3()
    g[0]![0] = seat('ic-technical-program-manager') // cap 4
    g[0]![1] = seat('mgmt-chief-financial-officer') // cap 3
    const { funding, loose } = fillBudgetLinesAtEnd(g, 10)
    expect(funding.reduce((n, f) => n + f.amount, 0)).toBe(7)
    expect(loose).toBe(3)
  })

  it('leaves everything loose with no budget lines', () => {
    expect(fillBudgetLinesAtEnd(grid3(), 12)).toEqual({
      funding: [],
      loose: 12,
    })
  })

  it('ignores a budget line left as an open seat', () => {
    const g = grid3()
    g[0]![0] = { openSeat: true }
    expect(fillBudgetLinesAtEnd(g, 5).loose).toBe(5)
  })

  it('tops up a line that already holds money', () => {
    const g = grid3()
    g[0]![0] = seat('ic-icon-designer', 6) // cap 9
    const { funding, loose } = fillBudgetLinesAtEnd(g, 5)
    expect(funding).toEqual([{ r: 0, c: 0, amount: 3 }])
    expect(loose).toBe(2)
  })
})

describe('deck-wide ability coverage', () => {
  // Every ability must resolve without throwing, on an empty org and on a full
  // one, for every branch of every choice.
  it('resolves every card ability in every branch', () => {
    const full = grid3()
    let i = 0
    for (let r = 0; r < 3; r++)
      for (let c = 0; c < 3; c++) full[r]![c] = seat(DECK[i++]!.id, 2)
    for (const c of DECK) {
      const branches = Math.max(1, 2 ** choiceCount(c))
      for (let b = 0; b < branches; b++) {
        expect(() => resolveAbility(c, empty(), empty(), [b])).not.toThrow()
        expect(() =>
          resolveAbility(c, player(full, 5), player(full, 5), [b]),
        ).not.toThrow()
      }
    }
  })
})
