/**
 * The draw pile and the discard pile.
 *
 * @remarks
 *   Rounds do not each start from a full deck. Cards from a finished round go to
 *   the discard and stay there, and the next round carries on with whatever is
 *   left, which is what makes late rounds tense. Only an empty draw pile brings
 *   the discards back.
 *
 *   A reshuffle can happen mid-round, and when it does the cards already in front
 *   of players stay exactly where they are, busted players included. Nothing
 *   here touches a player, which is what makes that true.
 */
import { buildDeck, type DeckCard } from './cards'

export interface DeckState {
  /** Drawn from the end. */
  draw: DeckCard[]
  discard: DeckCard[]
}

/** A source of numbers in `[0, 1)`. */
export type Random = () => number

/** Fisher-Yates, in place. */
export function shuffle(cards: DeckCard[], next: Random): DeckCard[] {
  for (let i = cards.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1))
    const a = cards[i]!
    cards[i] = cards[j]!
    cards[j] = a
  }
  return cards
}

export function createDeck(next: Random): DeckState {
  return { draw: shuffle(buildDeck(), next), discard: [] }
}

/**
 * Take the top card, shuffling the discards back in first if the draw pile has
 * run out. Returns `null` only when both piles are empty, which needs all 94
 * cards to be in front of players at once.
 */
export function drawCard(deck: DeckState, next: Random): DeckCard | null {
  if (deck.draw.length === 0) {
    if (deck.discard.length === 0) return null
    deck.draw = shuffle(deck.discard, next)
    deck.discard = []
  }
  return deck.draw.pop() ?? null
}

export function discardCards(
  deck: DeckState,
  cards: readonly DeckCard[],
): void {
  for (const card of cards) deck.discard.push(card)
}
