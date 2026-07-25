/**
 * Versus coordinator: two independent {@link BoardSession}s advanced in
 * lockstep. A board that reaches its target freezes and waits (it emits
 * `cleared`); only when BOTH are cleared do they advance together after a hold.
 * The match ends the moment either board runs out of lives; the winner is the
 * higher final score (which folds in the survivor's remaining-lives bonus).
 */
import {
  createEmitter,
  ignoreAbort,
  type Emitter,
  type EngineHost,
} from '@src/stargazer'
import { BoardSession } from './session'
import { ACCENT_VS, ANIM } from './tuning'
import type { Bounds } from './types'

export interface MatchEvents {
  /** Winner: 1, 2, or 0 for a tie. */
  matchOver: { winner: 0 | 1 | 2; pointsA: number; pointsB: number }
}

export class Match {
  readonly events: Emitter<MatchEvents> = createEmitter<MatchEvents>()
  readonly a: BoardSession
  readonly b: BoardSession

  readonly #host: EngineHost
  #clearedA = false
  #clearedB = false
  #over = false
  #gen = 0

  constructor(
    host: EngineHost,
    boundsA: Bounds,
    boundsB: Bounds,
    cols: number,
    rows: number,
  ) {
    this.#host = host
    this.a = new BoardSession(host, boundsA, cols, rows, ACCENT_VS[1], {
      autoAdvance: false,
    })
    this.b = new BoardSession(host, boundsB, cols, rows, ACCENT_VS[2], {
      autoAdvance: false,
    })
    this.a.events.on('cleared', () => this.#onCleared('a'))
    this.b.events.on('cleared', () => this.#onCleared('b'))
    this.a.events.on('gameOver', () => this.#endMatch())
    this.b.events.on('gameOver', () => this.#endMatch())
  }

  start(): void {
    this.#over = false
    this.#clearedA = false
    this.#clearedB = false
    this.a.start()
    this.b.start()
  }

  pause(): void {
    this.#host.engine.setPaused(true)
  }
  resume(): void {
    this.#host.engine.setPaused(false)
  }

  reset(): void {
    this.#gen += 1
    this.#over = false
    this.#clearedA = false
    this.#clearedB = false
    this.a.reset()
    this.b.reset()
  }

  destroy(): void {
    this.#gen += 1
    this.a.destroy()
    this.b.destroy()
  }

  #onCleared(which: 'a' | 'b'): void {
    if (this.#over) return
    if (which === 'a') this.#clearedA = true
    else this.#clearedB = true
    if (this.#clearedA && this.#clearedB) void this.#advanceBoth(++this.#gen)
  }

  async #advanceBoth(gen: number): Promise<void> {
    await this.#host.engine.wait(ANIM.levelClearHold).catch(ignoreAbort)
    if (gen !== this.#gen || this.#over) return
    this.#clearedA = false
    this.#clearedB = false
    this.a.advanceLevel()
    this.b.advanceLevel()
  }

  #endMatch(): void {
    if (this.#over) return
    this.#over = true
    this.a.board.freeze()
    this.b.board.freeze()
    const pa = this.a.finalPoints
    const pb = this.b.finalPoints
    const winner: 0 | 1 | 2 = pa > pb ? 1 : pb > pa ? 2 : 0
    this.events.emit('matchOver', { winner, pointsA: pa, pointsB: pb })
  }
}
