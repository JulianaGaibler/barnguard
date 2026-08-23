/**
 * The contest: one shared board, two players, alternating turns.
 *
 * Player 1 grows from the top-left corner, player 2 from the bottom-right, and
 * each turn floods only that player's own region. Cells are never taken back,
 * so the board fills monotonically and needs no move limit to end. Score is
 * cells held.
 *
 * Turns rather than a clock, because reading the board is the whole game and a
 * timer would reward the faster tapper instead of the better plan. A turn
 * passes only once the flood has settled, so nobody plays into a board still
 * moving.
 *
 * The match also ends the moment either player is walled in. A player with no
 * unowned cell touching their region can never gain again, so the rest of the
 * board is already the opponent's and there is nothing left to watch.
 *
 * A player who is not walled in always has a colour that gains ground, so play
 * that takes ground always reaches an end. Two players who both keep choosing
 * colours that take nothing can hold the board open indefinitely. That is
 * visibly self-inflicted, since nothing on screen moves, and the arcade's
 * swipe-down exit is always there, so the rules do not police it: forcing a
 * gainful move would mean telling players which colours touch their region,
 * which is the read the game is made of.
 */
import {
  AbortScope,
  createEmitter,
  ignoreAbort,
  type Emitter,
  type EngineHost,
} from '@src/stargazer'
import type { Random } from '../../common/rng'
import {
  applyMove,
  createMoveResult,
  isBlocked,
  ownedCount,
  regionColor,
  unownedCount,
  type Board,
  type MoveResult,
} from './board'
import { dealBoard, type DealtBoard } from './generate'
import { ANIM, floodDuration } from './tuning'
import type { Color, PlayerId, PresetId } from './types'

export type TerritoryState = 'dealing' | 'playing' | 'settling' | 'over'

/** Why the contest ended, which is what the result card explains. */
export type TerritoryEnding = 'boardFull' | 'walledIn'

export interface TerritoryEvents {
  stateChanged: TerritoryState
  /** Whose turn it is now. */
  turnChanged: PlayerId
  /**
   * A move landed.
   *
   * `result` is the reused buffer, so a handler reads what it needs before
   * returning.
   */
  moved: { player: PlayerId; color: Color; result: MoveResult }
  /** Cells held, after a move. */
  counts: { a: number; b: number; unowned: number }
  /** The contest is over. `winner` is 0 for a tie. */
  matchOver: {
    winner: 0 | PlayerId
    a: number
    b: number
    ending: TerritoryEnding
  }
}

interface TerritorySessionOptions {
  host: EngineHost
  preset: PresetId
  random: Random
  /** A deal made elsewhere, which is how a test can set up a given position. */
  deal?: DealtBoard
}

export class TerritorySession {
  readonly events: Emitter<TerritoryEvents> = createEmitter<TerritoryEvents>()

  readonly #host: EngineHost
  readonly #preset: PresetId
  readonly #random: Random
  readonly #scope = new AbortScope()

  #board: Board
  #result: MoveResult
  #turn: PlayerId = 1
  #state: TerritoryState = 'dealing'

  constructor(opts: TerritorySessionOptions) {
    this.#host = opts.host
    this.#preset = opts.preset
    this.#random = opts.random
    this.#board = (opts.deal ?? dealBoard(opts.preset, opts.random, 2)).board
    this.#result = createMoveResult(this.#board)
  }

  get board(): Board {
    return this.#board
  }
  get state(): TerritoryState {
    return this.#state
  }
  get turn(): PlayerId {
    return this.#turn
  }
  get total(): number {
    return this.#board.color.length
  }
  /** True while a tap from `player` would be accepted. */
  canPlay(player: PlayerId): boolean {
    return this.#state === 'playing' && this.#turn === player
  }
  count(player: PlayerId): number {
    return ownedCount(this.#board, player)
  }
  /** The color a player's region shows, which a move to the same color rejects. */
  currentColor(player: PlayerId): Color {
    return regionColor(this.#board, player)
  }

  start(): void {
    this.#turn = 1
    this.#setState('dealing')
    this.#emitCounts()
    void this.#openAfterDeal(this.#scope.reset())
  }

  /** Deal a fresh shared board and reopen the contest. */
  redeal(): void {
    this.#scope.abort()
    this.#board = dealBoard(this.#preset, this.#random, 2).board
    this.#result = createMoveResult(this.#board)
    this.start()
  }

  destroy(): void {
    this.#scope.dispose()
  }

  /**
   * Flood `player`'s region to `color`. Returns false when the tap changed
   * nothing: it is not their turn, the board is settling or over, or their
   * region already shows that color.
   *
   * A move that takes no cells is legal. It costs the turn, which is the price
   * of misreading the board, and keeping it legal means the buttons never have
   * to tell a player which colors are adjacent.
   */
  play(player: PlayerId, color: Color): boolean {
    if (!this.canPlay(player)) return false
    if (!applyMove(this.#board, player, color, this.#result)) return false

    this.events.emit('moved', { player, color, result: this.#result })
    this.#emitCounts()
    this.#setState('settling')
    void this.#passTurnAfterFlood(this.#scope.reset(), player)
    return true
  }

  async #openAfterDeal(signal: AbortSignal): Promise<void> {
    await this.#host.engine
      .wait(ANIM.dealDurationCap, signal)
      .catch(ignoreAbort)
    if (signal.aborted || this.#state !== 'dealing') return
    this.#setState('playing')
    this.events.emit('turnChanged', this.#turn)
  }

  async #passTurnAfterFlood(
    signal: AbortSignal,
    mover: PlayerId,
  ): Promise<void> {
    const settle = floodDuration(this.#result.maxDepth) + ANIM.turnHandoffPad
    await this.#host.engine.wait(settle, signal).catch(ignoreAbort)
    if (signal.aborted || this.#state !== 'settling') return

    const ending = this.#endingNow()
    if (ending) {
      this.#finish(ending)
      return
    }
    this.#turn = mover === 1 ? 2 : 1
    this.#setState('playing')
    this.events.emit('turnChanged', this.#turn)
  }

  /** Why the contest is over, or null while it is still live. */
  #endingNow(): TerritoryEnding | null {
    if (unownedCount(this.#board) === 0) return 'boardFull'
    if (isBlocked(this.#board, 1) || isBlocked(this.#board, 2)) {
      return 'walledIn'
    }
    return null
  }

  #finish(ending: TerritoryEnding): void {
    // A walled-in player concedes the open ground: their opponent is the only
    // one who can still take it, so counting it for them now is the same result
    // as playing it out, minus the wait.
    let a = ownedCount(this.#board, 1)
    let b = ownedCount(this.#board, 2)
    if (ending === 'walledIn') {
      const open = unownedCount(this.#board)
      if (isBlocked(this.#board, 1) && !isBlocked(this.#board, 2)) b += open
      else if (isBlocked(this.#board, 2) && !isBlocked(this.#board, 1))
        a += open
    }
    this.#setState('over')
    const winner: 0 | PlayerId = a > b ? 1 : b > a ? 2 : 0
    this.events.emit('matchOver', { winner, a, b, ending })
  }

  #emitCounts(): void {
    this.events.emit('counts', {
      a: ownedCount(this.#board, 1),
      b: ownedCount(this.#board, 2),
      unowned: unownedCount(this.#board),
    })
  }

  #setState(state: TerritoryState): void {
    this.#state = state
    this.events.emit('stateChanged', state)
  }
}
