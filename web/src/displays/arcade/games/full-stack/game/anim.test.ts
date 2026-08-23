import { describe, expect, it } from 'vitest'
import { entranceFor, type SlotShot } from './anim'
import { ANIM } from './tuning'
import { DECK } from './rules/deck'

const a = DECK[0]!
const b = DECK[1]!
const shot = (card = a, faceDown = false): SlotShot => ({ card, faceDown })

describe('what a slot change looks like', () => {
  it('deals a slot nothing was drawing', () => {
    expect(entranceFor(null, shot())).toBe('deal')
  })

  it('deals a slot that refilled with a different card', () => {
    expect(entranceFor(shot(a), shot(b))).toBe('deal')
  })

  // A dry deck reshuffles its own discards, so a redealt card can come straight
  // back to a different slot. That is a deal like any other.
  it('deals the same card arriving in a slot it was not in', () => {
    expect(entranceFor(shot(b), shot(a))).toBe('deal')
  })

  it('flips a card that only changed which way up it is', () => {
    expect(entranceFor(shot(a, false), shot(a, true))).toBe('flip')
    expect(entranceFor(shot(a, true), shot(a, false))).toBe('flip')
  })

  // A resize is the common case: every slot holds what it held, and nothing
  // should move.
  it('leaves an unchanged slot alone', () => {
    expect(entranceFor(shot(a), shot(a))).toBe('none')
    expect(entranceFor(shot(a, true), shot(a, true))).toBe('none')
  })

  // Turning a card face down hides which card it is, so a face-down slot that
  // is refilled has to still read as a deal.
  it('tells a refill apart from a turn even while face down', () => {
    expect(entranceFor(shot(a, true), shot(b, true))).toBe('deal')
  })
})

describe('timings', () => {
  it('are all positive', () => {
    for (const [name, value] of Object.entries(ANIM)) {
      expect(value, name).toBeGreaterThan(0)
    }
  })

  // A row is staggered by starting each card later than the last. A stagger as
  // long as the motion would finish the row out of order.
  it('stagger a row without reordering it', () => {
    expect(ANIM.dealStagger).toBeLessThan(ANIM.dealIn)
    expect(ANIM.tossStagger).toBeLessThan(ANIM.toss)
  })

  it('give a tapped hire longer than a dragged one', () => {
    // A drag has already crossed the board, so its card only takes weight.
    expect(ANIM.travel).toBeGreaterThan(ANIM.settle)
  })
})
