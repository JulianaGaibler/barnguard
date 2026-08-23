/**
 * One puzzle board: its move allowance, its progress, and the short state
 * machine around dealing, playing and finishing. Wraps a {@link Board} and
 * publishes every change through a typed emitter the UI subscribes to.
 *
 * The solo mode runs one of these. The race runs two on identical deals and
 * lets a coordinator decide the winner. Nothing here knows about the scene, so
 * the rules stay testable without an engine beyond the clock.
 *
 * The one thing it waits on is the deal-in sweep, held under an
 * {@link AbortScope} so `redeal` and `destroy` cancel it and a board that has
 * been replaced can never open itself.
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
  isFlooded,
  ownedCount,
  regionColor,
  type Board,
  type MoveResult,
} from './board'
import { dealBoard, type DealtBoard } from './generate'
import { ANIM } from './tuning'
import type { Color, Outcome, PresetId } from './types'

export type PuzzleState = 'dealing' | 'playing' | 'won' | 'lost'

export interface PuzzleEvents {
  stateChanged: PuzzleState
  /**
   * A move landed.
   *
   * `result` is the session's own reused buffer, so a handler has to read what
   * it needs before returning. The board node copies the depths into its wave
   * arrays on the spot.
   */
  moved: { color: Color; result: MoveResult; movesUsed: number }
  /** Cells held out of the total, after a move. */
  progress: { owned: number; total: number }
  /** The board is over. Fires once per board. */
  finished: { outcome: Outcome; movesUsed: number; maxMoves: number }
}

interface PuzzleSessionOptions {
  host: EngineHost
  preset: PresetId
  random: Random
  /**
   * A deal made elsewhere. The race passes one deal to both of its sessions,
   * which is how both players get the same board.
   */
  deal?: DealtBoard
}

export class PuzzleSession {
  readonly events: Emitter<PuzzleEvents> = createEmitter<PuzzleEvents>()

  readonly #host: EngineHost
  readonly #preset: PresetId
  readonly #random: Random

  #board: Board
  #result: MoveResult
  #maxMoves: number
  #par: number
  #movesUsed = 0
  #state: PuzzleState = 'dealing'
  readonly #scope = new AbortScope()

  constructor(opts: PuzzleSessionOptions) {
    this.#host = opts.host
    this.#preset = opts.preset
    this.#random = opts.random
    const deal = opts.deal ?? dealBoard(opts.preset, opts.random, 1)
    this.#board = deal.board
    this.#maxMoves = deal.maxMoves
    this.#par = deal.par
    this.#result = createMoveResult(this.#board)
  }

  get board(): Board {
    return this.#board
  }
  get state(): PuzzleState {
    return this.#state
  }
  get movesUsed(): number {
    return this.#movesUsed
  }
  get maxMoves(): number {
    return this.#maxMoves
  }
  get par(): number {
    return this.#par
  }
  get owned(): number {
    return ownedCount(this.#board, 1)
  }
  get total(): number {
    return this.#board.color.length
  }
  /** The color the region shows now, which a move to the same color rejects. */
  get currentColor(): Color {
    return regionColor(this.#board, 1)
  }
  /** True once the board is over, either way. */
  get finished(): boolean {
    return this.#state === 'won' || this.#state === 'lost'
  }

  /** Open the board: hold through the deal-in sweep, then accept taps. */
  start(): void {
    this.#movesUsed = 0
    this.#setState('dealing')
    this.events.emit('progress', { owned: this.owned, total: this.total })
    void this.#openAfterDeal(this.#scope.reset())
  }

  /**
   * Flood the region to `color`. Returns false when the tap changed nothing:
   * the board is not accepting moves, or the region already shows that color.
   */
  play(color: Color): boolean {
    if (this.#state !== 'playing') return false
    if (!applyMove(this.#board, 1, color, this.#result)) return false

    this.#movesUsed++
    this.events.emit('moved', {
      color,
      result: this.#result,
      movesUsed: this.#movesUsed,
    })
    this.events.emit('progress', { owned: this.owned, total: this.total })

    if (isFlooded(this.#board, 1)) this.#finish('flooded')
    else if (this.#movesUsed >= this.#maxMoves) this.#finish('outOfMoves')
    return true
  }

  /** Take a fresh board at the same preset and open it. */
  redeal(deal?: DealtBoard): void {
    this.#scope.abort()
    const next = deal ?? dealBoard(this.#preset, this.#random, 1)
    this.#board = next.board
    this.#maxMoves = next.maxMoves
    this.#par = next.par
    this.#result = createMoveResult(this.#board)
    this.start()
  }

  destroy(): void {
    this.#scope.dispose()
  }

  async #openAfterDeal(signal: AbortSignal): Promise<void> {
    await this.#host.engine
      .wait(ANIM.dealDurationCap, signal)
      .catch(ignoreAbort)
    if (signal.aborted || this.#state !== 'dealing') return
    this.#setState('playing')
  }

  #finish(outcome: Outcome): void {
    this.#setState(outcome === 'flooded' ? 'won' : 'lost')
    this.events.emit('finished', {
      outcome,
      movesUsed: this.#movesUsed,
      maxMoves: this.#maxMoves,
    })
  }

  #setState(state: PuzzleState): void {
    this.#state = state
    this.events.emit('stateChanged', state)
  }
}
