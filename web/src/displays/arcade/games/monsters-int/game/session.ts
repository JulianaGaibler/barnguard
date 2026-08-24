/**
 * The turn machine: pulls steps out of the rules layer and paces them on the
 * clock so a player can watch what happened.
 *
 * @remarks
 *   The only engine facility used here is `engine.wait`. Everything visual goes
 *   through the scene handle, and every tween lives in a node. That is what
 *   lets a test drive the whole machine with a fake clock and no canvas.
 *
 *   Nothing awaits a tween. The rules mutate synchronously, a scene call starts
 *   an animation and returns, and the machine holds on the clock. A teardown
 *   mid-animation therefore cannot deadlock.
 * @example
 *   const session = startSession({ host, scene, seats: 4 })
 *   session.events.on('awaitingTurn', (t) => (controls = t))
 *   session.hit()
 */
import {
  AbortScope,
  createEmitter,
  ignoreAbort,
  type Emitter,
  type EngineHost,
} from '@src/stargazer'
import { createDeck, discardCards, type DeckState } from './rules/deck'
import {
  applyRoundScores,
  createMatch,
  endMatch,
  randomFor,
  standings,
  type MatchState,
  type Standing,
} from './rules/match'
import { scorePlayer, type RoundScore, type SeatId } from './rules/player'
import {
  applyInput,
  collectRoundCards,
  createRound,
  stepRound,
  type RoundEvent,
  type RoundState,
} from './rules/round'
import { PACE } from './tuning'
import { MONSTERS_INT_STRINGS as copy } from '../strings'
import type { SeatCount } from './seats'

/** What the controls should offer right now. */
export interface TurnPrompt {
  seat: SeatId
  canStay: boolean
}

/** A choice the table has to make before play continues. */
export interface TargetPrompt {
  kind: 'freeze' | 'threeMore' | 'giveLife'
  /** Who is choosing. */
  seat: SeatId
  eligible: readonly SeatId[]
}

/**
 * What the table is waiting on or reacting to, for the readout on the lip.
 *
 * Split rather than one sentence, because the readout leads with the seat's
 * SHAPE and not its name. A player matches the shape in front of them to the
 * shape on the banner without reading a word, which is the whole reason seats
 * are named by shape in the first place.
 */
export interface TableStatus {
  /** Whose shape leads the line, or null for something nobody owns. */
  seat: SeatId | null
  /** Follows the shape: `'s turn!`, ` draws`, ` is out`. */
  text: string
  /** A quieter line under it, saying what to do about it. Often empty. */
  note: string
}

export interface RoundSummary {
  scores: readonly RoundScore[]
  totals: readonly number[]
  reason: 'noActive' | 'seven'
}

export interface GameOver {
  standings: readonly Standing[]
  winners: readonly SeatId[]
  rounds: number
  /** Whether the table called it rather than someone reaching the target. */
  early: boolean
}

export interface SessionEvents {
  roundStarted: { round: number }
  /** Whatever the rules just did, in order. Already applied to the scene. */
  effects: readonly RoundEvent[]
  awaitingTurn: TurnPrompt | null
  awaitingTarget: TargetPrompt | null
  roundOver: RoundSummary
  gameOver: GameOver
}

/** What the session needs from the table. Kept narrow so a test can fake it. */
export interface SessionScene {
  apply(event: RoundEvent, round: RoundState): void
  beginRound(round: RoundState): void
  setActiveSeat(seat: SeatId | null, round: RoundState | null): void
  setControlsEnabled(enabled: boolean, canStay?: boolean): void
  /** Refresh the readouts over the table. */
  sync(round: RoundState, match: MatchState, status: TableStatus): void
  clearRound(): void
}

export interface SessionOptions {
  host: EngineHost
  scene: SessionScene
  seats: SeatCount
  seed?: number
}

export interface Session {
  readonly events: Emitter<SessionEvents>
  readonly match: MatchState
  hit(): void
  stay(): void
  pickTarget(seat: SeatId): void
  /** Start the next round after a summary. */
  nextRound(): void
  /**
   * Call the match where it stands: bank the round in progress, then settle on
   * whoever is ahead.
   */
  endNow(): void
  destroy(): void
}

/** What a prompt is waiting for, as a shape and a line about it. */
function promptStatus(
  kind: 'turn' | 'freeze' | 'threeMore' | 'giveLife',
  seat: SeatId,
): TableStatus {
  switch (kind) {
    case 'turn':
      return { seat, text: copy.turn, note: copy.turnNote }
    case 'freeze':
      return { seat, text: copy.drewFreeze, note: copy.aimFreezeNote }
    case 'threeMore':
      return { seat, text: copy.drewThreeMore, note: copy.aimThreeMoreNote }
    case 'giveLife':
      return { seat, text: copy.hasSpareLife, note: copy.giveLifeNote }
  }
}

/**
 * What an event says, for the readout.
 *
 * Null where the line already up says it better, which is the turn handover:
 * the prompt right behind it names whose turn it now is.
 */
export function narrate(
  event: RoundEvent,
  round: RoundState,
): TableStatus | null {
  const at = (seat: SeatId, text: string, note = ''): TableStatus => ({
    seat,
    text,
    note,
  })
  switch (event.type) {
    case 'dealt':
      // Before the first turn every card is part of the opening deal, which is
      // the stretch that most needs saying out loud.
      return round.turnIndex < 0
        ? at(event.seat, copy.isDealt)
        : at(event.seat, copy.draws)
    case 'duplicate':
      return at(event.seat, copy.alreadyHas)
    case 'lifeSpent':
      return at(event.seat, copy.spendsLife, copy.spendsLifeNote)
    case 'busted':
      return at(event.seat, copy.isOut, copy.isOutNote)
    case 'seven':
      return at(event.seat, copy.hasSeven, copy.hasSevenNote)
    case 'stayed':
      return at(event.seat, copy.staysWith, copy.staysWithNote)
    case 'frozen':
      return at(event.seat, copy.isFrozen, copy.isFrozenNote)
    case 'threeMoreStarted':
      return at(event.seat, copy.takesThree, copy.takesThreeNote)
    case 'lifeTaken':
      return at(event.seat, copy.takesLife, copy.takesLifeNote)
    case 'lifeGiven':
      return at(event.to, copy.getsLife, copy.getsLifeNote)
    case 'lifeDiscarded':
      return { seat: null, text: copy.dropsLife, note: '' }
    case 'reshuffled':
      return { seat: null, text: copy.reshuffling, note: '' }
    default:
      return null
  }
}

/**
 * How long the table holds on an event, in seconds.
 *
 * Only the deal reads its context. Everywhere else `PACE` is the whole story,
 * which is what keeps the pacing legible as one table rather than as rules
 * scattered through the loop.
 */
export function holdFor(event: RoundEvent, round: RoundState): number {
  if (event.type === 'dealt' && round.turnIndex < 0) {
    // An action card still gets a full look. It changes the round before
    // anybody has played, so it is the one deal worth stopping for.
    const quick = event.card.card.kind === 'number'
    return (quick ? PACE.dealing : PACE.dealt) ?? 0
  }
  return PACE[event.type] ?? 0
}

export function startSession(opts: SessionOptions): Session {
  const { host, scene, seats } = opts
  const events = createEmitter<SessionEvents>()
  const match = createMatch(
    seats,
    opts.seed ?? (Math.random() * 0xffffffff) >>> 0,
  )
  const scope = new AbortScope()
  const random = randomFor(match)

  let deck: DeckState = createDeck(random)
  let round: RoundState | null = null
  /** Resolves whichever prompt is open. Null when nothing is waiting. */
  let answer: ((value: unknown) => void) | null = null
  let destroyed = false

  /** Wait for the player, or unwind if the game is torn down first. */
  function ask<T>(signal: AbortSignal): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      if (signal.aborted) {
        reject(new DOMException('Aborted', 'AbortError'))
        return
      }
      const onAbort = (): void => {
        answer = null
        reject(new DOMException('Aborted', 'AbortError'))
      }
      signal.addEventListener('abort', onAbort, { once: true })
      answer = (value) => {
        signal.removeEventListener('abort', onAbort)
        answer = null
        resolve(value as T)
      }
    })
  }

  /** What the table is waiting on, as a shape and a line. */
  let status: TableStatus = { seat: null, text: '', note: '' }

  /** Play a batch of rules events, holding on the clock between each. */
  async function present(
    batch: readonly RoundEvent[],
    signal: AbortSignal,
  ): Promise<void> {
    if (!round) return
    for (const event of batch) {
      status = narrate(event, round) ?? status
      scene.apply(event, round)
      scene.sync(round, match, status)
      await host.engine.wait(holdFor(event, round), signal)
      if (signal.aborted) return
    }
    events.emit('effects', batch)
  }

  async function runRound(signal: AbortSignal): Promise<void> {
    const state = createRound(seats, deck, match.round % seats)
    round = state
    scene.beginRound(state)
    events.emit('roundStarted', { round: match.round + 1 })

    while (!state.ended && !signal.aborted) {
      if (state.pending.kind === 'none') {
        await present(stepRound(state, random), signal)
        continue
      }
      const pending = state.pending
      if (pending.kind === 'turn') {
        status = promptStatus('turn', pending.seat)
        scene.setActiveSeat(pending.seat, state)
        scene.setControlsEnabled(true, pending.canStay)
        scene.sync(state, match, status)
        events.emit('awaitingTurn', {
          seat: pending.seat,
          canStay: pending.canStay,
        })
        const choice = await ask<'hit' | 'stay'>(signal)
        scene.setControlsEnabled(false)
        events.emit('awaitingTurn', null)
        await present(applyInput(state, { kind: choice }), signal)
        continue
      }
      // A Freeze, a Three More, or a spare life needing a home.
      const kind = pending.kind === 'giveLife' ? 'giveLife' : pending.action
      status = promptStatus(kind, pending.seat)
      scene.sync(state, match, status)
      // The card is standing at the reveal. Let it be read before the picker
      // opens on top of the table it is standing over.
      await host.engine.wait(PACE.beforeTarget ?? 0, signal)
      if (signal.aborted) return
      events.emit('awaitingTarget', {
        kind,
        seat: pending.seat,
        eligible: pending.eligible,
      })
      const seat = await ask<SeatId>(signal)
      events.emit('awaitingTarget', null)
      await present(applyInput(state, { kind: 'target', seat }), signal)
    }
    if (signal.aborted) return
    await finishRound(state, signal)
  }

  async function finishRound(
    state: RoundState,
    signal: AbortSignal,
  ): Promise<void> {
    // No line here. The summary opens on top of it and says the same thing
    // with the numbers attached.
    status = { seat: null, text: '', note: '' }
    scene.setActiveSeat(null, state)
    scene.setControlsEnabled(false)
    scene.sync(state, match, status)
    const scores = state.players.map(scorePlayer)
    applyRoundScores(match, scores)
    discardCards(deck, collectRoundCards(state))
    // Scored and swept, so there is no round in progress any more. `endNow`
    // reads this to decide whether it still has one to bank.
    round = null

    await host.engine.wait(PACE.roundSettle, signal)
    if (signal.aborted) return

    if (match.over) {
      events.emit('gameOver', gameOver(false))
      return
    }
    events.emit('roundOver', {
      scores,
      totals: [...match.totals],
      reason: state.ended ?? 'noActive',
    })
  }

  function gameOver(early: boolean): GameOver {
    return {
      standings: standings(match),
      winners: match.winners,
      rounds: match.round,
      early,
    }
  }

  /** Kick the first round. Later ones come from `nextRound`. */
  void runRound(scope.reset()).catch(ignoreAbort)

  return {
    events,
    match,
    hit() {
      answer?.('hit')
    },
    stay() {
      answer?.('stay')
    },
    pickTarget(seat) {
      answer?.(seat)
    },
    nextRound() {
      if (destroyed || match.over) return
      scene.clearRound()
      round = null
      void runRound(scope.reset()).catch(ignoreAbort)
    },
    endNow() {
      if (destroyed || match.over) return
      // Unwind the round loop first. It holds on the clock between events, so
      // letting it run on would score the round a second time.
      scope.abort()
      answer = null
      scene.setControlsEnabled(false)
      // A round in progress counts as it stands. Stopping mid-round and
      // throwing the cards away would let whoever is behind gain by leaving.
      if (round) {
        applyRoundScores(match, round.players.map(scorePlayer))
        scene.setActiveSeat(null, round)
        round = null
      }
      endMatch(match)
      events.emit('gameOver', gameOver(true))
    },
    destroy() {
      destroyed = true
      scope.dispose()
      answer = null
      round = null
      deck = createDeck(random)
    },
  }
}
