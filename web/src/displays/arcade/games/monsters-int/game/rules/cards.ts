/**
 * The 94-card deck, as data.
 *
 * @remarks
 *   A card carries no behaviour. Everything that happens to one is decided in
 *   `round.ts` by matching on `kind`, which keeps the rules in one place rather
 *   than spread across per-card branches.
 *
 *   The written ruleset calls the freeze card "Skip". The art names it Freeze and
 *   the mechanic freezes a player out of the round rather than skipping a turn,
 *   so Freeze is the name used throughout.
 */

/** A plus modifier's value. The deck holds one of each. */
export type PlusValue = 2 | 4 | 6 | 8 | 10

export type Card =
  | { kind: 'number'; value: number }
  | { kind: 'plus'; amount: PlusValue }
  | { kind: 'times2' }
  | { kind: 'freeze' }
  | { kind: 'threeMore' }
  | { kind: 'extraLife' }

/** Which of the 23 artwork files a card shows. */
export type CardFaceId = string

/**
 * One physical card, so a mesh can follow the same card through a round even
 * though two copies of a number are otherwise identical.
 */
export interface DeckCard {
  readonly id: string
  readonly card: Card
}

export const DECK_SIZE = 94
/** Highest number in the deck. Also the count of that number's copies. */
export const MAX_NUMBER = 12
/** Unique numbers that end the round and earn the bonus. */
export const SEVEN_GOAL = 7

export const PLUS_VALUES: readonly PlusValue[] = [2, 4, 6, 8, 10]
/** Copies of each action card. */
export const ACTION_COPIES = 3

/**
 * Every card in the deck, unshuffled.
 *
 * Number `n` appears `n` times, so high numbers are both worth more and far
 * more likely to be the duplicate that busts you. The zero appears once: it
 * scores nothing but still counts toward the seven unique numbers, which makes
 * it the safest card in the deck.
 */
export function buildDeck(): DeckCard[] {
  const out: DeckCard[] = []
  out.push({ id: 'n0', card: { kind: 'number', value: 0 } })
  for (let value = 1; value <= MAX_NUMBER; value++) {
    for (let copy = 0; copy < value; copy++) {
      out.push({ id: `n${value}-${copy}`, card: { kind: 'number', value } })
    }
  }
  for (const amount of PLUS_VALUES) {
    out.push({ id: `plus${amount}`, card: { kind: 'plus', amount } })
  }
  out.push({ id: 'x2', card: { kind: 'times2' } })
  for (const action of ['freeze', 'threeMore', 'extraLife'] as const) {
    for (let copy = 0; copy < ACTION_COPIES; copy++) {
      out.push({ id: `${action}-${copy}`, card: { kind: action } })
    }
  }
  return out
}

/** The artwork file a card shows, without its extension. */
export function faceOf(card: Card): CardFaceId {
  switch (card.kind) {
    case 'number':
      return `card-${String(card.value).padStart(2, '0')}`
    case 'plus':
      return `bonus-plus-${card.amount}`
    case 'times2':
      return 'bonus-times-two'
    case 'freeze':
      return 'action-freeze'
    case 'threeMore':
      return 'action-3more'
    case 'extraLife':
      return 'action-life'
  }
}

/** Whether a card is chosen onto a target rather than kept by the drawer. */
export function isTargeted(
  card: Card,
): card is { kind: 'freeze' | 'threeMore' } {
  return card.kind === 'freeze' || card.kind === 'threeMore'
}
