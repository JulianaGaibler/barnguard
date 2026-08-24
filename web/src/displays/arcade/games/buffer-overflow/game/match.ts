/**
 * Two seats racing on one piece sequence.
 *
 * The sessions never touch. There is no attack, no garbage and no shared
 * buffer: what makes it a race is that both draw from the same seed, so the nth
 * piece is identical for both and neither can blame the deal. Each keeps its
 * own ordinal, so a player further along is simply further into the same
 * sequence.
 *
 * One player running out does not end the match. The other plays to their own
 * end and the higher score wins, which is what keeps a two-player score
 * comparable to a solo one and lets both post to the same board. The cost is
 * that a strong survivor can leave the other waiting, so the component shows
 * the eliminated player the live score they are being chased by and Quit ends
 * the match for both.
 */
import {
  createEmitter,
  Node2D,
  type Emitter,
  type EngineHost,
} from '@src/stargazer'
import { Session } from './session'
import type { ModeKind, PlayerId } from './types'

/** A finished seat. */
export interface SeatResult {
  score: number
  lines: number
  level: number
}

export interface MatchEvents {
  /** One seat finished. The other may still be playing. */
  playerOut: { player: PlayerId; result: SeatResult }
  /** Both are done. `winner` is 0 for a tie. */
  matchOver: { winner: 0 | PlayerId; a: SeatResult; b: SeatResult }
}

export class Match {
  readonly events: Emitter<MatchEvents> = createEmitter<MatchEvents>()
  /** The caller parents this. Holds both sessions' roots. */
  readonly root = new Node2D('buffer-overflow-match')
  readonly a: Session
  readonly b: Session

  #outA: SeatResult | null = null
  #outB: SeatResult | null = null
  #over = false

  constructor(host: EngineHost, mode: ModeKind, seed: number) {
    this.a = new Session({ host, mode, seed, player: 1 })
    this.b = new Session({ host, mode, seed, player: 2 })
    this.root.add(this.a.root, this.b.root)
    this.a.events.on('over', (e) => this.#onOut(1, e))
    this.b.events.on('over', (e) => this.#onOut(2, e))
  }

  get over(): boolean {
    return this.#over
  }

  /** The seat, by id. */
  session(player: PlayerId): Session {
    return player === 1 ? this.a : this.b
  }

  /** Whether a seat has finished, which is what freezes its half of the view. */
  isOut(player: PlayerId): boolean {
    return (player === 1 ? this.#outA : this.#outB) !== null
  }

  start(): void {
    this.#outA = null
    this.#outB = null
    this.#over = false
    this.a.start()
    this.b.start()
  }

  destroy(): void {
    this.a.destroy()
    this.b.destroy()
    if (!this.root.isDestroyed) this.root.destroy()
  }

  #onOut(player: PlayerId, result: SeatResult): void {
    if (this.#over) return
    if (player === 1) {
      if (this.#outA) return
      this.#outA = result
    } else {
      if (this.#outB) return
      this.#outB = result
    }
    this.events.emit('playerOut', { player, result })
    if (this.#outA && this.#outB) this.#end(this.#outA, this.#outB)
  }

  #end(a: SeatResult, b: SeatResult): void {
    this.#over = true
    const winner: 0 | PlayerId =
      a.score > b.score ? 1 : b.score > a.score ? 2 : 0
    this.events.emit('matchOver', { winner, a, b })
  }
}
