/**
 * One round: the deal, the turn loop, and every card resolution in between.
 *
 * @remarks
 *   Two rules refuse to fit a plain reducer. The deal pauses to resolve an action
 *   card and then carries on where it left off, and Three More defers any
 *   Freeze or Three More it turns up until all three cards are drawn. Both are
 *   continuations, so the round carries an explicit LIFO task queue and they
 *   fall out of it rather than needing special cases.
 *
 *   Nothing here knows about timing. `stepRound` mutates and returns a
 *   chronological list of {@link RoundEvent}s, and the caller decides how long
 *   each one takes to watch. That is what keeps the rules testable in a plain
 *   loop with no clock and no canvas.
 * @example
 *   const round = createRound(4, deck)
 *   let events = stepRound(round, rng) // advance until it needs input
 *   if (round.pending.kind === 'turn')
 *     events = applyInput(round, { kind: 'hit' })
 */
import { isTargeted, SEVEN_GOAL, type DeckCard } from './cards'
import { drawCard, type DeckState, type Random } from './deck'
import {
  canStay,
  createPlayer,
  hasNumber,
  isActive,
  uniqueCount,
  type PlayerState,
  type SeatId,
} from './player'

/** Why a round stopped. */
export type RoundEnding = 'noActive' | 'seven'

export type RoundTask =
  /** One card of the opening deal, for a seat that may no longer be active. */
  | { kind: 'deal'; seat: SeatId }
  /** A single card to this seat, from a Hit or from inside a Three More. */
  | { kind: 'draw'; seat: SeatId }
  /** A Three More run. `deferred` collects actions it turned up on the way. */
  | { kind: 'threeMore'; target: SeatId; left: number; deferred: DeckCard[] }
  /** A Freeze or Three More waiting to be aimed. */
  | { kind: 'action'; seat: SeatId; card: DeckCard }
  /** Hand the turn to the next active seat. */
  | { kind: 'nextTurn' }

export type RoundPending =
  | { kind: 'none' }
  | { kind: 'turn'; seat: SeatId; canStay: boolean }
  | {
      kind: 'target'
      /** Who is choosing. */
      seat: SeatId
      action: 'freeze' | 'threeMore'
      card: DeckCard
      eligible: readonly SeatId[]
    }
  | {
      kind: 'giveLife'
      /** Who has to give the spare away. */
      seat: SeatId
      card: DeckCard
      eligible: readonly SeatId[]
    }

export type RoundEvent =
  | { type: 'dealt'; seat: SeatId; card: DeckCard }
  | { type: 'duplicate'; seat: SeatId; card: DeckCard }
  | { type: 'lifeSpent'; seat: SeatId; life: DeckCard; duplicate: DeckCard }
  | { type: 'busted'; seat: SeatId }
  | { type: 'seven'; seat: SeatId }
  | { type: 'stayed'; seat: SeatId }
  | { type: 'frozen'; seat: SeatId; by: SeatId }
  | { type: 'threeMoreStarted'; seat: SeatId; by: SeatId }
  | { type: 'lifeTaken'; seat: SeatId }
  | { type: 'lifeGiven'; from: SeatId; to: SeatId }
  | { type: 'lifeDiscarded'; seat: SeatId }
  | { type: 'reshuffled' }
  | { type: 'turnChanged'; seat: SeatId | null }
  | { type: 'roundOver'; reason: RoundEnding }

export type RoundInput =
  { kind: 'hit' } | { kind: 'stay' } | { kind: 'target'; seat: SeatId }

export interface RoundState {
  players: PlayerState[]
  deck: DeckState
  /** Seats in turn order. */
  order: SeatId[]
  /** Index into `order` of whoever is up. */
  turnIndex: number
  /** LIFO. The last entry runs next. */
  queue: RoundTask[]
  pending: RoundPending
  ended: RoundEnding | null
  /** Who reached seven, when that is why the round ended. */
  sevenSeat: SeatId | null
}

/**
 * Deal one card to each seat in turn order.
 *
 * Pushed in reverse because the queue is LIFO, so seat order comes back out the
 * right way round.
 */
export function createRound(
  seats: number,
  deck: DeckState,
  dealer = 0,
): RoundState {
  const players = Array.from({ length: seats }, (_, i) => createPlayer(i))
  // The deal starts to the dealer's left and the turn loop follows the same
  // order, so rotating here rotates who plays first each round.
  const order = Array.from({ length: seats }, (_, i) => (dealer + i) % seats)
  const queue: RoundTask[] = [{ kind: 'nextTurn' }]
  for (let i = order.length - 1; i >= 0; i--) {
    queue.push({ kind: 'deal', seat: order[i]! })
  }
  return {
    players,
    deck,
    order,
    turnIndex: -1,
    queue,
    pending: { kind: 'none' },
    ended: null,
    sevenSeat: null,
  }
}

export const activeSeats = (state: RoundState): SeatId[] =>
  state.players.filter(isActive).map((p) => p.seat)

/**
 * Seats a Freeze or Three More may be aimed at, which is every active player
 * including the one who drew it. A player left alone in the round has to aim it
 * at themselves.
 */
export const eligibleTargets = (state: RoundState): SeatId[] =>
  activeSeats(state)

/**
 * Advance by the smallest observable step, returning what happened.
 *
 * A no-op while input is pending or the round is over, so a caller can loop on
 * it without checking first.
 */
export function stepRound(state: RoundState, next: Random): RoundEvent[] {
  if (state.pending.kind !== 'none' || state.ended) return []
  const task = state.queue.pop()
  if (!task) {
    // Nothing left to do means nobody is still playing.
    return finish(state, 'noActive')
  }
  const events: RoundEvent[] = []
  runTask(state, task, next, events)
  return events
}

/** Satisfy `state.pending`. Throws on input the pending state does not accept. */
export function applyInput(state: RoundState, input: RoundInput): RoundEvent[] {
  const pending = state.pending
  const events: RoundEvent[] = []
  if (
    pending.kind === 'turn' &&
    (input.kind === 'hit' || input.kind === 'stay')
  ) {
    state.pending = { kind: 'none' }
    if (input.kind === 'hit') {
      state.queue.push(
        { kind: 'nextTurn' },
        { kind: 'draw', seat: pending.seat },
      )
      return events
    }
    const player = state.players[pending.seat]!
    if (!canStay(player)) {
      throw new Error(
        `Monsters, Int: seat ${pending.seat} cannot stay with nothing`,
      )
    }
    player.status = 'stayed'
    events.push({ type: 'stayed', seat: pending.seat })
    state.queue.push({ kind: 'nextTurn' })
    return events
  }
  if (pending.kind === 'target' && input.kind === 'target') {
    if (!pending.eligible.includes(input.seat)) {
      throw new Error(`Monsters, Int: seat ${input.seat} is not a legal target`)
    }
    state.pending = { kind: 'none' }
    applyAction(state, pending.card, pending.seat, input.seat, events)
    return events
  }
  if (pending.kind === 'giveLife' && input.kind === 'target') {
    if (!pending.eligible.includes(input.seat)) {
      throw new Error(`Monsters, Int: seat ${input.seat} cannot take a life`)
    }
    state.pending = { kind: 'none' }
    giveLife(state, pending.card, pending.seat, input.seat, events)
    return events
  }
  throw new Error(
    `Monsters, Int: ${input.kind} does not answer a ${pending.kind} prompt`,
  )
}

/** Every card on the table, for sweeping it into the discard at round end. */
export function collectRoundCards(state: RoundState): DeckCard[] {
  const out: DeckCard[] = []
  for (const p of state.players) {
    out.push(...p.numbers, ...p.modifiers, ...p.spent)
    if (p.life) out.push(p.life)
  }
  return out
}

// --- internals -------------------------------------------------------------

function runTask(
  state: RoundState,
  task: RoundTask,
  next: Random,
  events: RoundEvent[],
): void {
  switch (task.kind) {
    case 'deal':
    case 'draw': {
      // A seat frozen earlier in the deal never receives its opening card.
      if (!isActive(state.players[task.seat]!)) return
      const card = takeCard(state, next, events)
      if (card) receive(state, task.seat, card, events)
      return
    }
    case 'threeMore':
      return runThreeMore(state, task)
    case 'action':
      return promptOrAutoTarget(state, task.seat, task.card, events)
    case 'nextTurn':
      return advanceTurn(state, events)
  }
}

function takeCard(
  state: RoundState,
  next: Random,
  events: RoundEvent[],
): DeckCard | null {
  const before = state.deck.draw.length
  const card = drawCard(state.deck, next)
  if (before === 0 && card) events.push({ type: 'reshuffled' })
  return card
}

/** Resolve one card arriving in front of a seat. */
function receive(
  state: RoundState,
  seat: SeatId,
  card: DeckCard,
  events: RoundEvent[],
): void {
  const player = state.players[seat]!
  events.push({ type: 'dealt', seat, card })

  if (card.card.kind === 'number') {
    if (hasNumber(player, card.card.value)) {
      events.push({ type: 'duplicate', seat, card })
      if (player.life) {
        // The life and the duplicate both leave the table. The player plays on.
        const life = player.life
        player.life = null
        player.spent.push(life, card)
        events.push({ type: 'lifeSpent', seat, life, duplicate: card })
        return
      }
      player.status = 'busted'
      player.numbers.push(card)
      events.push({ type: 'busted', seat })
      checkEnd(state, events)
      return
    }
    player.numbers.push(card)
    if (uniqueCount(player) >= SEVEN_GOAL) {
      player.status = 'hasSeven'
      events.push({ type: 'seven', seat })
      state.sevenSeat = seat
      finishInto(state, 'seven', events)
    }
    return
  }

  if (card.card.kind === 'plus' || card.card.kind === 'times2') {
    player.modifiers.push(card)
    return
  }

  if (card.card.kind === 'extraLife') {
    receiveLife(state, seat, card, events)
    return
  }

  // Freeze and Three More are aimed. Inside a run they wait their turn.
  const run = enclosingRun(state)
  if (run) {
    run.deferred.push(card)
    return
  }
  promptOrAutoTarget(state, seat, card, events)
}

/**
 * The Three More task currently running, if this draw came from inside one.
 *
 * A run pushes itself back and then pushes its draw on top, so when that draw
 * resolves its own run is whatever sits at the top of the queue.
 */
function enclosingRun(
  state: RoundState,
): Extract<RoundTask, { kind: 'threeMore' }> | null {
  const top = state.queue[state.queue.length - 1]
  return top?.kind === 'threeMore' ? top : null
}

function receiveLife(
  state: RoundState,
  seat: SeatId,
  card: DeckCard,
  events: RoundEvent[],
): void {
  const player = state.players[seat]!
  if (!player.life) {
    player.life = card
    events.push({ type: 'lifeTaken', seat })
    return
  }
  // A second life has to go to an active player who has none.
  const eligible = activeSeats(state).filter(
    (s) => s !== seat && !state.players[s]!.life,
  )
  if (eligible.length === 0) {
    player.spent.push(card)
    events.push({ type: 'lifeDiscarded', seat })
    return
  }
  if (eligible.length === 1) {
    giveLife(state, card, seat, eligible[0]!, events)
    return
  }
  state.pending = { kind: 'giveLife', seat, card, eligible }
}

function giveLife(
  state: RoundState,
  card: DeckCard,
  from: SeatId,
  to: SeatId,
  events: RoundEvent[],
): void {
  state.players[to]!.life = card
  events.push({ type: 'lifeGiven', from, to })
}

/** Aim an action, prompting only when there is a choice to make. */
function promptOrAutoTarget(
  state: RoundState,
  seat: SeatId,
  card: DeckCard,
  events: RoundEvent[],
): void {
  if (!isTargeted(card.card)) return
  const eligible = eligibleTargets(state)
  if (eligible.length === 0) {
    state.players[seat]!.spent.push(card)
    return
  }
  if (eligible.length === 1) {
    applyAction(state, card, seat, eligible[0]!, events)
    return
  }
  state.pending = {
    kind: 'target',
    seat,
    action: card.card.kind,
    card,
    eligible,
  }
}

function applyAction(
  state: RoundState,
  card: DeckCard,
  by: SeatId,
  target: SeatId,
  events: RoundEvent[],
): void {
  state.players[by]!.spent.push(card)
  if (card.card.kind === 'freeze') {
    const player = state.players[target]!
    player.status = 'stayed'
    events.push({ type: 'frozen', seat: target, by })
    checkEnd(state, events)
    return
  }
  events.push({ type: 'threeMoreStarted', seat: target, by })
  state.queue.push({ kind: 'threeMore', target, left: 3, deferred: [] })
}

function runThreeMore(
  state: RoundState,
  task: Extract<RoundTask, { kind: 'threeMore' }>,
): void {
  const target = state.players[task.target]!
  // A bust stops the run and cancels everything it turned up, per the rules.
  if (target.status === 'busted') return
  if (task.left > 0 && isActive(target) && !state.ended) {
    state.queue.push(
      {
        kind: 'threeMore',
        target: task.target,
        left: task.left - 1,
        deferred: task.deferred,
      },
      { kind: 'draw', seat: task.target },
    )
    return
  }
  // The run is done. Anything it turned up resolves now, in draw order, which
  // means pushing in reverse.
  for (let i = task.deferred.length - 1; i >= 0; i--) {
    state.queue.push({
      kind: 'action',
      seat: task.target,
      card: task.deferred[i]!,
    })
  }
}

function advanceTurn(state: RoundState, events: RoundEvent[]): void {
  if (state.ended) return
  const seats = state.order
  for (let step = 1; step <= seats.length; step++) {
    const index = (state.turnIndex + step) % seats.length
    const seat = seats[index]!
    if (isActive(state.players[seat]!)) {
      state.turnIndex = index
      state.pending = {
        kind: 'turn',
        seat,
        canStay: canStay(state.players[seat]!),
      }
      events.push({ type: 'turnChanged', seat })
      return
    }
  }
  finishInto(state, 'noActive', events)
}

/** End the round if nobody is left to play. */
function checkEnd(state: RoundState, events: RoundEvent[]): void {
  if (state.ended) return
  if (activeSeats(state).length === 0) finishInto(state, 'noActive', events)
}

function finish(state: RoundState, reason: RoundEnding): RoundEvent[] {
  const events: RoundEvent[] = []
  finishInto(state, reason, events)
  return events
}

function finishInto(
  state: RoundState,
  reason: RoundEnding,
  events: RoundEvent[],
): void {
  if (state.ended) return
  state.ended = reason
  state.queue.length = 0
  state.pending = { kind: 'none' }
  events.push({ type: 'turnChanged', seat: null })
  events.push({ type: 'roundOver', reason })
}
