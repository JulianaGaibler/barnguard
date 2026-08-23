/**
 * A two-player match: two boards running at once off one shared spawn stream.
 *
 * The boards never interact, so this is a scoreboard and a lifecycle rather
 * than a coordinator. What it does own is the survivor rule, taken from
 * JezzBall: one player getting stuck does NOT end the match. Their board
 * freezes and is marked out while the other plays on, and the match ends only
 * once both are finished, so a player who dies early can still win on points.
 *
 * Both sessions share one {@link SpawnStream}, which is what makes the match a
 * race rather than two unrelated games: each player's nth tile has the same
 * value and lands in the same relative slot as their opponent's. They keep
 * separate ordinal counters, so a player who has made more moves is simply
 * further along the same sequence.
 */
import { createEmitter, type Emitter, type EngineHost } from '@src/stargazer'
import { BoardSession } from './session'
import { createSpawnStream } from './spawn'
import { TWENTY48_STRINGS as S } from '../strings'
import { ACCENT_VS } from './tuning'
import type { Bounds } from './types'

export interface MatchEvents {
  /** One player is finished. The other keeps going. */
  playerOut: { which: 'a' | 'b'; score: number }
  matchOver: { winner: 0 | 1 | 2; scoreA: number; scoreB: number }
}

export class Match {
  readonly events: Emitter<MatchEvents> = createEmitter<MatchEvents>()
  readonly a: BoardSession
  readonly b: BoardSession

  #outA = false
  #outB = false
  #over = false

  constructor(host: EngineHost, slotA: Bounds, slotB: Bounds, seed: number) {
    const stream = createSpawnStream(seed)
    this.a = new BoardSession(host, slotA, stream, ACCENT_VS[1], {
      outLabel: S.out,
    })
    this.b = new BoardSession(host, slotB, stream, ACCENT_VS[2], {
      outLabel: S.out,
    })
    this.a.events.on('gameOver', () => this.#onOut('a'))
    this.b.events.on('gameOver', () => this.#onOut('b'))
  }

  get scoreA(): number {
    return this.a.score
  }

  get scoreB(): number {
    return this.b.score
  }

  start(): void {
    this.#outA = false
    this.#outB = false
    this.#over = false
    this.a.start()
    this.b.start()
  }

  setSlots(slotA: Bounds, slotB: Bounds): void {
    this.a.setSlot(slotA)
    this.b.setSlot(slotB)
  }

  #onOut(which: 'a' | 'b'): void {
    if (this.#over) return
    if (which === 'a') {
      if (this.#outA) return
      this.#outA = true
    } else {
      if (this.#outB) return
      this.#outB = true
    }
    const session = which === 'a' ? this.a : this.b
    this.events.emit('playerOut', { which, score: session.score })
    // The board has already veiled itself with `outLabel`, so all that is left
    // is deciding whether the match is over or the survivor plays on.
    if (this.#outA && this.#outB) this.#end()
  }

  #end(): void {
    if (this.#over) return
    this.#over = true
    const scoreA = this.a.score
    const scoreB = this.b.score
    const winner: 0 | 1 | 2 = scoreA > scoreB ? 1 : scoreB > scoreA ? 2 : 0
    this.events.emit('matchOver', { winner, scoreA, scoreB })
  }

  destroy(): void {
    this.a.destroy()
    this.b.destroy()
  }
}
