import { describe, expect, it } from 'vitest'
import { holdFor, narrate } from './session'
import { createRound, stepRound, type RoundEvent } from './rules/round'
import type { SeatId } from './rules/player'
import {
  fixedRandom,
  life as lifeCard,
  n,
  stackedDeck,
} from './rules/scriptedDeck'
import { ANIM, PACE } from './tuning'

// Pacing is the whole feel of the game, and the rules layer knows nothing about
// it. The deal is the one place the hold reads its context, so it is the one
// place worth pinning.

/** The first `dealt` event a stack produces, with the round it happened in. */
function firstDeal(...cards: Parameters<typeof stackedDeck>): {
  event: Extract<RoundEvent, { type: 'dealt' }>
  round: ReturnType<typeof createRound>
} {
  const round = createRound(3, stackedDeck(...cards))
  for (let i = 0; i < 20; i++) {
    for (const event of stepRound(round, fixedRandom)) {
      if (event.type === 'dealt') return { event, round }
    }
  }
  throw new Error('no card was dealt')
}

describe('holdFor', () => {
  it('deals faster than it draws', () => {
    const { event, round } = firstDeal(n(1), n(2), n(3))
    expect(holdFor(event, round)).toBe(PACE.dealing)
    expect(PACE.dealing!).toBeLessThan(PACE.dealt!)
  })

  it('stops for an action card even in the deal', () => {
    const { event, round } = firstDeal(lifeCard, n(2), n(3))
    expect(holdFor(event, round)).toBe(PACE.dealt)
  })

  it('reads the table for everything else', () => {
    const { round } = firstDeal(n(1), n(2), n(3))
    expect(holdFor({ type: 'busted', seat: 0 }, round)).toBe(PACE.busted)
    expect(holdFor({ type: 'reshuffled' }, round)).toBe(PACE.reshuffled)
  })
})

// The readout leads with a seat's SHAPE and not its name, so what it needs from
// each event is not a sentence but a seat and the tail of one. An event that
// names a player and hands back no seat leaves the line starting mid-word.
describe('narrate', () => {
  const round = createRound(3, stackedDeck(n(1), n(2), n(3)))
  const seat: SeatId = 1

  const OWNED: RoundEvent[] = [
    { type: 'duplicate', seat, card: { id: 'x', card: n(4) } },
    { type: 'busted', seat },
    { type: 'seven', seat },
    { type: 'stayed', seat },
    { type: 'frozen', seat, by: 0 },
    { type: 'threeMoreStarted', seat, by: 0 },
    { type: 'lifeTaken', seat },
    { type: 'lifeGiven', from: 0, to: seat },
  ]

  it('hands back the seat whose shape the line belongs to', () => {
    for (const event of OWNED) {
      const said = narrate(event, round)
      expect(said, event.type).not.toBeNull()
      expect(said!.seat, event.type).toBe(seat)
      expect(said!.text, event.type).not.toBe('')
    }
  })

  it('reads as a tail, so the shape can lead the line', () => {
    for (const event of OWNED) {
      // A leading space or an apostrophe: either way it follows something.
      expect(narrate(event, round)!.text, event.type).toMatch(/^[ ']/)
    }
  })

  it('owns nothing to no seat rather than to seat zero', () => {
    for (const event of [
      { type: 'reshuffled' },
      { type: 'lifeDiscarded', seat },
    ] as RoundEvent[]) {
      expect(narrate(event, round)!.seat, event.type).toBeNull()
    }
  })

  it('says nothing on a turn handover, which the prompt behind it covers', () => {
    expect(narrate({ type: 'turnChanged', seat }, round)).toBeNull()
  })
})

// A card that has to be aimed stops at the reveal so the table can see what it
// is. Its own hold starts as it leaves the mouth, though, so a third of that is
// spent watching it fly rather than reading it.
describe('the beat before a picker opens', () => {
  it('holds after the card has landed, not only while it travels', () => {
    expect(PACE.beforeTarget).toBeGreaterThan(ANIM.move)
  })

  it('gives an action card longer on show than a number in the deal', () => {
    const life = firstDeal(lifeCard, n(2), n(3))
    const number = firstDeal(n(1), n(2), n(3))
    expect(holdFor(life.event, life.round)).toBeGreaterThan(
      holdFor(number.event, number.round),
    )
  })
})
