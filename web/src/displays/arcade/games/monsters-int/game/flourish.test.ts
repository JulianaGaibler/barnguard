import { describe, expect, it } from 'vitest'
import { burstFor, cardColor, type FlourishKind } from './flourish'
import type { DeckCard } from './rules/cards'
import { COLORS, SEATS } from './tuning'

const at = { x: 640, y: 480 }

/** Every beat, so a new one cannot be added without a feel to go with it. */
const KINDS: readonly FlourishKind[] = [
  'spit',
  'bust',
  'save',
  'dissolve',
  'shatter',
  'float',
  'seven',
]

const card = (kind: DeckCard['card']['kind']): DeckCard =>
  ({ id: 'x', card: { kind } }) as DeckCard

describe('cardColor', () => {
  it('is the accent the card face is drawn in', () => {
    expect(cardColor(card('freeze'))).toBe(COLORS.freeze)
    expect(cardColor(card('threeMore'))).toBe(COLORS.threeMore)
    expect(cardColor(card('extraLife'))).toBe(COLORS.extraLife)
    expect(cardColor(card('plus'))).toBe(COLORS.bonus)
    expect(cardColor(card('times2'))).toBe(COLORS.times2)
  })

  it('gives a number card the paper it is printed on', () => {
    expect(cardColor(card('number'))).toBe(COLORS.cream)
  })
})

describe('burstFor', () => {
  it('gives every beat something to throw, at the point it happened', () => {
    for (const kind of KINDS) {
      const specs = burstFor({ kind, at, seat: 2, color: COLORS.freeze })
      expect(specs.length, kind).toBeGreaterThan(0)
      for (const spec of specs) {
        expect(spec.count, kind).toBeGreaterThan(0)
        expect(spec.palette.length, kind).toBeGreaterThan(0)
        expect([spec.x, spec.y], kind).toEqual([at.x, at.y])
      }
    }
  })

  // It fires on every card in the game. Dark pieces that often stop reading as
  // an event and start reading as the table needing a wipe.
  it('keeps the deal clear of ink, since it repeats all round', () => {
    const [spec] = burstFor({ kind: 'spit', at })
    expect(spec!.palette).not.toContain(COLORS.ink)
    expect(spec!.palette).not.toContain(COLORS.inkShade)
  })

  it('spits upward, out of the mouth', () => {
    const [spec] = burstFor({ kind: 'spit', at })
    // Screen y grows downward, so up is negative.
    expect(Math.sin(spec!.axis!)).toBeLessThan(0)
  })

  it("throws the winner their own colour, and nobody else's", () => {
    for (let seat = 0; seat < SEATS.length; seat++) {
      const [own] = burstFor({ kind: 'seven', at, seat })
      expect(own!.palette, `seat ${seat}`).toEqual([SEATS[seat]!.color])
    }
  })

  // One colour at one size is a strong read and a flat one.
  it('sends smaller, quicker flecks up with the winner colour', () => {
    const specs = burstFor({ kind: 'seven', at, seat: 0 })
    expect(specs).toHaveLength(2)
    expect(specs[1]!.size[1]).toBeLessThan(specs[0]!.size[0])
    expect(specs[1]!.life[1]).toBeLessThan(specs[0]!.life[1])
  })

  it('dissolves a card in its own accent', () => {
    const [spec] = burstFor({ kind: 'dissolve', at, color: COLORS.times2 })
    expect(spec!.palette).toContain(COLORS.times2)
  })

  // Long enough to arc up and come back down, which is what the lifetimes are
  // for. A piece that dies at the top of its arc never reads as having weight.
  it('gives every piece long enough to fall', () => {
    for (const kind of KINDS) {
      const specs = burstFor({ kind, at, seat: 0, color: COLORS.freeze })
      for (const spec of specs) {
        expect(spec.life[0], kind).toBeGreaterThanOrEqual(0.7)
      }
    }
  })

  // A Freeze is a punishment and a Three More is a gift. They arrive the same
  // way and must not look the same doing it.
  it('makes the freeze shatter and the three more float', () => {
    const [shatter] = burstFor({ kind: 'shatter', at, color: COLORS.freeze })
    const [float] = burstFor({ kind: 'float', at, color: COLORS.threeMore })
    expect(shatter!.gravity).toBeGreaterThan(0)
    expect(float!.gravity).toBeLessThan(0)
    expect(float!.life[0]).toBeGreaterThan(shatter!.life[1])
    expect(shatter!.speed[1]).toBeGreaterThan(float!.speed[1])
  })
})
