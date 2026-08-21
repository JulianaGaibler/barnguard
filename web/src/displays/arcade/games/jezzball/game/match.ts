/**
 * Versus coordinator: two independent {@link BoardSession}s. While both are
 * alive they advance in lockstep — a board that reaches its target freezes and
 * waits (it emits `cleared`); only when BOTH are cleared do they advance
 * together after a hold.
 *
 * When one board runs out of lives it is frozen and marked out (`playerOut`),
 * but the match keeps going: the survivor plays on alone, advancing by itself
 * each time it clears, until it too runs out. The match ends only once BOTH
 * boards are out (`matchOver`); the winner is the higher final score (which
 * folds in the survivor's remaining-lives bonus). Each player's final score is
 * captured at their own game-over, so both can be offered to the leaderboard.
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
  /**
   * A board ran out of lives and is frozen; the other keeps playing until it
   * does too. `points` is that player's final score.
   */
  playerOut: { which: 'a' | 'b'; points: number }
  /** Both boards are out. Winner: 1, 2, or 0 for a tie. */
  matchOver: { winner: 0 | 1 | 2; pointsA: number; pointsB: number }
}

export class Match {
  readonly events: Emitter<MatchEvents> = createEmitter<MatchEvents>()
  readonly a: BoardSession
  readonly b: BoardSession

  readonly #host: EngineHost
  #clearedA = false
  #clearedB = false
  #outA = false
  #outB = false
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
    this.a.events.on('gameOver', () => this.#onOut('a'))
    this.b.events.on('gameOver', () => this.#onOut('b'))
  }

  start(): void {
    this.#over = false
    this.#clearedA = false
    this.#clearedB = false
    this.#outA = false
    this.#outB = false
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
    this.#outA = false
    this.#outB = false
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
    // If the other board is already out, this board is the sole survivor and
    // has no partner to wait for — advance it alone after the celebration hold.
    const otherOut = which === 'a' ? this.#outB : this.#outA
    if (otherOut) {
      const survivor = which === 'a' ? this.a : this.b
      void this.#advanceSurvivor(++this.#gen, survivor)
      return
    }
    if (which === 'a') this.#clearedA = true
    else this.#clearedB = true
    if (this.#clearedA && this.#clearedB) void this.#advanceBoth(++this.#gen)
  }

  #onOut(which: 'a' | 'b'): void {
    if (this.#over) return
    if (which === 'a') this.#outA = true
    else this.#outB = true
    const session = which === 'a' ? this.a : this.b
    this.events.emit('playerOut', { which, points: session.finalPoints })

    if (this.#outA && this.#outB) {
      this.#endMatch()
      return
    }

    // One player is out; the match plays on solo, so lockstep no longer
    // applies. If the survivor had already cleared and was waiting for this
    // now-dead board, release it to the next level immediately — otherwise it
    // would wait forever for a partner that can never clear again.
    this.#clearedA = false
    this.#clearedB = false
    const survivor = which === 'a' ? this.b : this.a
    if (survivor.state === 'cleared') {
      this.#gen += 1
      survivor.advanceLevel()
    }
  }

  async #advanceBoth(gen: number): Promise<void> {
    await this.#host.engine.wait(ANIM.levelClearHold).catch(ignoreAbort)
    if (gen !== this.#gen || this.#over) return
    this.#clearedA = false
    this.#clearedB = false
    this.a.advanceLevel()
    this.b.advanceLevel()
  }

  async #advanceSurvivor(gen: number, survivor: BoardSession): Promise<void> {
    await this.#host.engine.wait(ANIM.levelClearHold).catch(ignoreAbort)
    if (gen !== this.#gen || this.#over) return
    survivor.advanceLevel()
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
