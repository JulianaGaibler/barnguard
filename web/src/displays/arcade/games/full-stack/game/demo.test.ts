import { describe, expect, it } from 'vitest'
import { DEMO_CARD_IDS, HIRE_ANCHOR, HIRE_PATH } from './demo'
import { cardFace } from './cardFace'
import { settleSide, type Side } from './rules/match'
import { DECK, type Card } from './rules/deck'
import { FULL_STACK_TUTORIAL } from '../tutorial'

const byId = (id: string): Card | undefined => DECK.find((c) => c.id === id)

// A tutorial card that points at part of a card face says nothing if that part
// is blank, and nothing in the demo itself would fail. These are what notice.
describe('the card the anatomy scenes point at', () => {
  const card = byId(DEMO_CARD_IDS.anatomy)

  it('is in the deck', () => {
    expect(card).toBeDefined()
  })

  it('carries a price, two departments and an elevator', () => {
    expect(card!.cost).toBeGreaterThan(0)
    expect(card!.groups.length).toBe(2)
    expect(card!.sendsMarkerTo).not.toBeNull()
  })

  it('has something written on both of its rules lines', () => {
    expect(card!.ability.length).toBeGreaterThan(0)
    expect(card!.scoring).toBeDefined()
  })
})

describe('the org the score reveal adds up', () => {
  const cards = DEMO_CARD_IDS.org.map(byId)

  it('is nine real cards', () => {
    expect(cards).toHaveLength(9)
    for (const card of cards) expect(card).toBeDefined()
  })

  // The reveal turns on one figure per seat, so a seat the scoring does not
  // account for would sit blank while the ones around it lit up.
  it('scores every seat and totals more than nothing', () => {
    const grid = Array.from({ length: 5 }, () =>
      Array.from({ length: 5 }, () => null as Side['grid'][0][0]),
    )
    cards.forEach((card, i) => {
      grid[Math.floor(i / 3)]![i % 3] = { card: card!, budget: 0 }
    })
    const result = settleSide({ grid, budget: 6, approvals: 3 })

    expect(result.breakdown.seats).toHaveLength(9)
    for (const seat of result.breakdown.seats) expect(seat.kind).toBe('card')
    expect(result.breakdown.total).toBeGreaterThan(0)
  })
})

// The highlights are cut from `cardFace`, so they cannot drift from the bands
// they ring. What they can do is fall outside the card, which would read as a
// stray box rather than as a pointer.
describe('the parts a scene rings', () => {
  const g = cardFace(200, 303)

  it('sits inside the card', () => {
    const bands = [g.onHire, g.reviewBand, g.elevator]
    for (const b of bands) {
      expect(b.x).toBeGreaterThanOrEqual(0)
      expect(b.y).toBeGreaterThanOrEqual(0)
      expect(b.x + b.width).toBeLessThanOrEqual(200)
      expect(b.y + b.height).toBeLessThanOrEqual(303)
    }
    expect(g.coin.cx - g.coin.r).toBeGreaterThanOrEqual(0)
    expect(g.badgeX + g.badgeSize).toBeLessThanOrEqual(200)
  })
})

// The shape the first card traces is the whole point of it: a filled row would
// say seats are taken in order, which is the one thing about placement that is
// not true.
describe('the seats the first card fills', () => {
  const path = [...HIRE_PATH]
  const all = [HIRE_ANCHOR, ...path]

  it('never places twice in the same seat', () => {
    const keys = all.map((s) => `${s.r},${s.c}`)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('keeps every seat inside the org', () => {
    for (const seat of all) {
      expect(seat.r).toBeGreaterThanOrEqual(0)
      expect(seat.r).toBeLessThan(3)
      expect(seat.c).toBeGreaterThanOrEqual(0)
      expect(seat.c).toBeLessThan(3)
    }
  })

  it('touches what is already down at every step', () => {
    const placed = [HIRE_ANCHOR as { r: number; c: number }]
    for (const seat of path) {
      const touches = placed.some(
        (p) => Math.abs(p.r - seat.r) + Math.abs(p.c - seat.c) === 1,
      )
      expect(touches, `${seat.r},${seat.c}`).toBe(true)
      placed.push(seat)
    }
  })

  it('turns a corner rather than filling a line', () => {
    const rows = new Set(all.map((s) => s.r))
    const cols = new Set(all.map((s) => s.c))
    expect(rows.size).toBeGreaterThan(1)
    expect(cols.size).toBeGreaterThan(1)
  })
})

describe('the carousel', () => {
  it('pairs every card with copy and a scene', () => {
    expect(FULL_STACK_TUTORIAL.length).toBeGreaterThan(0)
    for (const card of FULL_STACK_TUTORIAL) {
      expect(card.title).toBeTruthy()
      expect(card.body).toBeTruthy()
      expect(typeof card.build).toBe('function')
    }
  })

  // The carousel gives a body a fixed eight rems and hides the overflow, so a
  // long one is cut rather than wrapped. The house band is two sentences.
  it('keeps every body inside the space it is given', () => {
    for (const card of FULL_STACK_TUTORIAL) {
      const words = card.body.trim().split(/\s+/).length
      expect(words, card.title).toBeLessThanOrEqual(26)
      expect(
        card.title.trim().split(/\s+/).length,
        card.title,
      ).toBeLessThanOrEqual(4)
    }
  })

  it('gives every card its own scene', () => {
    const builds = FULL_STACK_TUTORIAL.map((c) => c.build)
    expect(new Set(builds).size).toBe(builds.length)
  })
})
