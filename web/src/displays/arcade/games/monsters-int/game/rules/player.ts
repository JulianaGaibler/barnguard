/**
 * One player's cards and standing within a round, and what they score.
 *
 * @remarks
 *   The scoring order is the part worth reading twice. The multiplier applies to
 *   the number cards ONLY, before any plus modifier is added, so a `x2` and a
 *   `+10` together are `sum * 2 + 10` rather than `(sum + 10) * 2`. Every other
 *   reading makes the pluses far stronger than the deck is balanced for.
 */
import type { DeckCard } from './cards'
import { SEVEN_GOAL } from './cards'

export type SeatId = number

export type PlayerStatus = 'active' | 'stayed' | 'busted' | 'hasSeven'

export interface PlayerState {
  readonly seat: SeatId
  status: PlayerStatus
  /** Face up in front of the player. Uniqueness here is what busts. */
  numbers: DeckCard[]
  /** Plus cards and the multiplier. Cannot bust, and never count toward seven. */
  modifiers: DeckCard[]
  /** The Extra Life in hand, or null. At most one. */
  life: DeckCard | null
  /**
   * Cards resolved and set aside in front of the player: a spent life, a Freeze
   * that was played. Kept so a round's cards can all be collected at the end.
   */
  spent: DeckCard[]
}

/** Points for reaching seven unique numbers. */
export const SEVEN_BONUS = 15

export function createPlayer(seat: SeatId): PlayerState {
  return {
    seat,
    status: 'active',
    numbers: [],
    modifiers: [],
    life: null,
    spent: [],
  }
}

export const isActive = (p: PlayerState): boolean => p.status === 'active'

/** Whether the player already holds this number, which is what busts them. */
export function hasNumber(p: PlayerState, value: number): boolean {
  return p.numbers.some(
    (c) => c.card.kind === 'number' && c.card.value === value,
  )
}

/** Distinct numbers held. Every number in `numbers` is unique by construction. */
export const uniqueCount = (p: PlayerState): number => p.numbers.length

/**
 * Whether the player may Stay. Staying with nothing in front of you is not a
 * move.
 */
export function canStay(p: PlayerState): boolean {
  return (
    isActive(p) && p.numbers.length + p.modifiers.length + (p.life ? 1 : 0) > 0
  )
}

/** A round score, broken out so the summary can show how it was reached. */
export interface RoundScore {
  seat: SeatId
  numberSum: number
  doubled: boolean
  plusTotal: number
  sevenBonus: number
  total: number
}

export function scorePlayer(p: PlayerState): RoundScore {
  let numberSum = 0
  for (const c of p.numbers) {
    if (c.card.kind === 'number') numberSum += c.card.value
  }
  let doubled = false
  let plusTotal = 0
  for (const c of p.modifiers) {
    if (c.card.kind === 'times2') doubled = true
    else if (c.card.kind === 'plus') plusTotal += c.card.amount
  }
  const sevenBonus =
    p.status === 'hasSeven' && uniqueCount(p) >= SEVEN_GOAL ? SEVEN_BONUS : 0

  // A busted player keeps their cards on the table but scores none of them.
  const total =
    p.status === 'busted'
      ? 0
      : numberSum * (doubled ? 2 : 1) + plusTotal + sevenBonus
  return { seat: p.seat, numberSum, doubled, plusTotal, sevenBonus, total }
}

/** Every card in front of a player, for sweeping the table at round end. */
export function playerCards(p: PlayerState): DeckCard[] {
  const out = [...p.numbers, ...p.modifiers, ...p.spent]
  if (p.life) out.push(p.life)
  return out
}
