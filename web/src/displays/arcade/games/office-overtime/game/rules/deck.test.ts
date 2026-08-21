// The deck is transcribed data, so a typo here is a silent balance bug rather
// than a crash. These totals are what the "missing group", "run of identical
// groups" and budget-line cards are balanced against, so every one is pinned.

import { describe, expect, it } from 'vitest'
import { ALL_GROUPS, DECK, DECK_BY_ID, type Card, type Group } from './deck'

const onFloor = (floor: Card['floor']) => DECK.filter((c) => c.floor === floor)
const cardsWith = (g: Group) => DECK.filter((c) => c.groups.includes(g))
const shieldsOf = (g: Group, cards: readonly Card[] = DECK) =>
  cards.reduce((n, c) => n + c.groups.filter((x) => x === g).length, 0)

describe('deck shape', () => {
  it('holds 78 cards split evenly between the floors', () => {
    expect(DECK).toHaveLength(78)
    expect(onFloor('management')).toHaveLength(39)
    expect(onFloor('ic')).toHaveLength(39)
  })

  it('has unique ids and unique names', () => {
    expect(new Set(DECK.map((c) => c.id)).size).toBe(78)
    expect(new Set(DECK.map((c) => c.name)).size).toBe(78)
    expect(DECK_BY_ID.size).toBe(78)
  })

  it('gives every card one or two groups', () => {
    for (const c of DECK) {
      expect(c.groups.length, c.id).toBeGreaterThanOrEqual(1)
      expect(c.groups.length, c.id).toBeLessThanOrEqual(2)
    }
  })
})

describe('group distribution', () => {
  it('matches the per-group card counts', () => {
    expect(ALL_GROUPS.map((g) => cardsWith(g).length)).toEqual([
      13, 15, 15, 16, 16, 18,
    ])
  })

  it('matches the per-group shield counts', () => {
    expect(ALL_GROUPS.map((g) => shieldsOf(g))).toEqual([
      15, 17, 17, 18, 18, 20,
    ])
    expect(ALL_GROUPS.reduce((n, g) => n + shieldsOf(g), 0)).toBe(105)
  })

  // Leadership is nearly absent from the IC floor and Design entirely absent
  // from Management. Cards that score on a missing group depend on that skew.
  it('matches the shield split by floor', () => {
    const split = ALL_GROUPS.map(
      (g) =>
        `${shieldsOf(g, onFloor('management'))}+${shieldsOf(g, onFloor('ic'))}`,
    )
    expect(split).toEqual(['14+1', '12+5', '11+6', '8+10', '7+11', '0+20'])
  })

  it('has 15 cards spanning two groups and 12 doubling one', () => {
    const two = DECK.filter((c) => new Set(c.groups).size === 2)
    const doubled = DECK.filter(
      (c) => c.groups.length === 2 && new Set(c.groups).size === 1,
    )
    expect(two).toHaveLength(15)
    expect(doubled).toHaveLength(12)
  })
})

describe('costs', () => {
  it('matches the cost histogram, with no $1 card', () => {
    const hist: Record<number, number> = {}
    for (const c of DECK) hist[c.cost] = (hist[c.cost] ?? 0) + 1
    expect(hist).toEqual({ 0: 12, 2: 12, 3: 10, 4: 16, 5: 15, 6: 7, 7: 6 })
  })
})

describe('budget lines', () => {
  const purses = DECK.filter((c) => c.scoring.score === 'budgetLine')

  // Every budget line pays the same rate, which is what makes the end-game
  // auto-fill optimal: only the total stored matters, never which card holds it.
  it('are 11 cards that all pay 2 per dollar', () => {
    expect(purses).toHaveLength(11)
    for (const c of purses) {
      if (c.scoring.score !== 'budgetLine') throw new Error('unreachable')
      expect(c.scoring.points, c.id).toBe(2)
    }
  })

  it('have the expected caps and total capacity', () => {
    const caps = purses
      .map((c) => (c.scoring.score === 'budgetLine' ? c.scoring.cap : 0))
      .sort((a, b) => a - b)
    expect(caps).toEqual([3, 4, 4, 4, 5, 5, 5, 6, 7, 8, 9])
    expect(caps.reduce((a, b) => a + b, 0)).toBe(60)
  })
})

describe('discounts and abilities', () => {
  const discounted = DECK.filter((c) => c.discount)

  it('has 15 discount cards split 4 all / 6 management / 5 IC', () => {
    expect(discounted).toHaveLength(15)
    const by = (on: string) =>
      discounted.filter((c) => c.discount?.on === on).length
    expect([by('all'), by('management'), by('ic')]).toEqual([4, 6, 5])
  })

  // A discount is the card's whole effect. Nothing grants both.
  it('gives discount cards no ability and every other card one', () => {
    for (const c of discounted) expect(c.ability, c.id).toEqual([])
    for (const c of DECK.filter((c) => !c.discount)) {
      expect(c.ability.length, c.id).toBeGreaterThan(0)
    }
  })

  it('has 3 two-effect cards and 8 offering a choice', () => {
    expect(DECK.filter((c) => c.ability.length === 2)).toHaveLength(3)
    expect(
      DECK.filter((c) => c.ability.some((e) => e.effect === 'choose')),
    ).toHaveLength(8)
  })
})

describe('floor marker ribbons', () => {
  it('splits 40 none / 19 management / 19 IC', () => {
    const by = (t: Card['sendsMarkerTo']) =>
      DECK.filter((c) => c.sendsMarkerTo === t).length
    expect([by(null), by('management'), by('ic')]).toEqual([40, 19, 19])
  })

  // A card never sends the marker to its own floor. This is why the `ribbon`
  // metric counts the card's floor rather than its marker target: reading the
  // target would invert every result.
  it('never sends the marker to the card own floor', () => {
    expect(DECK.filter((c) => c.sendsMarkerTo === c.floor)).toEqual([])
  })
})
