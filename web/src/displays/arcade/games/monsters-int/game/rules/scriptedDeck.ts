/**
 * Decks stacked by hand, so a round reads as the situation it is rather than as
 * a seed that happens to produce it.
 *
 * Written for the rules tests and used by the tutorial too: a card explaining
 * what a duplicate does needs a duplicate on the second draw, every time, and
 * the alternative is a demo that scripts its own outcome and can quietly stop
 * matching the rules it is teaching.
 */
import type { Card, DeckCard } from './cards'
import type { DeckState } from './deck'

/** A number card. */
export const n = (value: number): Card => ({ kind: 'number', value })
export const plus = (amount: 2 | 4 | 6 | 8 | 10): Card => ({
  kind: 'plus',
  amount,
})
export const x2: Card = { kind: 'times2' }
export const freeze: Card = { kind: 'freeze' }
export const threeMore: Card = { kind: 'threeMore' }
export const life: Card = { kind: 'extraLife' }

/**
 * A deck that deals these cards in this order. The draw pile is popped from the
 * end, so the list is reversed on the way in.
 */
export function stackedDeck(...cards: Card[]): DeckState {
  const draw: DeckCard[] = cards.map((card, i) => ({ id: `t${i}`, card }))
  draw.reverse()
  return { draw, discard: [] }
}

/** An RNG that never varies, for a case where the shuffle must not matter. */
export const fixedRandom = (): number => 0
