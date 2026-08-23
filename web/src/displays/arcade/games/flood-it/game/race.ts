/**
 * The race: two {@link PuzzleSession}s on the same deal, decided by move count.
 *
 * Both players work at their own pace rather than in turns, so neither waits on
 * the other. A player who finishes first freezes and waits, and the match
 * resolves only once both boards are over. Deciding on moves rather than on who
 * finished first is what keeps it a puzzle contest: thinking longer costs
 * nothing, playing worse costs the match.
 */
import { createEmitter, type Emitter, type EngineHost } from '@src/stargazer'
import type { Random } from '../../common/rng'
import { cloneBoard } from './board'
import { dealBoard } from './generate'
import { PuzzleSession } from './session'
import type { Outcome, PlayerId, PresetId } from './types'

/** How one player's board ended, which is all the resolution needs. */
export interface RaceResult {
  outcome: Outcome
  movesUsed: number
  owned: number
}

export interface RaceEvents {
  /** One player's board is over. The other plays on. */
  playerDone: { player: PlayerId; result: RaceResult }
  /** Both boards are over. `winner` is 0 for a tie. */
  matchOver: { winner: 0 | PlayerId; a: RaceResult; b: RaceResult }
}

/**
 * Who won, given how both boards ended.
 *
 * Flooding beats running out, however few moves the loser spent. Between two
 * floods the shorter one wins. Between two failures the larger region wins,
 * which rewards the player who got closer rather than calling it a draw.
 */
export function resolveRace(a: RaceResult, b: RaceResult): 0 | PlayerId {
  const aFlooded = a.outcome === 'flooded'
  const bFlooded = b.outcome === 'flooded'
  if (aFlooded !== bFlooded) return aFlooded ? 1 : 2
  if (aFlooded) {
    if (a.movesUsed !== b.movesUsed) return a.movesUsed < b.movesUsed ? 1 : 2
    return 0
  }
  if (a.owned !== b.owned) return a.owned > b.owned ? 1 : 2
  return 0
}

export class RaceMatch {
  readonly events: Emitter<RaceEvents> = createEmitter<RaceEvents>()
  readonly a: PuzzleSession
  readonly b: PuzzleSession

  #resultA: RaceResult | null = null
  #resultB: RaceResult | null = null
  #over = false

  constructor(host: EngineHost, preset: PresetId, random: Random) {
    const deal = dealBoard(preset, random, 1)
    // One deal, two boards. Cloning rather than sharing keeps each player's
    // moves off the other's grid while leaving the starting position identical.
    this.a = new PuzzleSession({
      host,
      preset,
      random,
      deal: { ...deal, board: cloneBoard(deal.board) },
    })
    this.b = new PuzzleSession({
      host,
      preset,
      random,
      deal: { ...deal, board: cloneBoard(deal.board) },
    })
    this.a.events.on('finished', (e) => this.#onDone(1, e))
    this.b.events.on('finished', (e) => this.#onDone(2, e))
  }

  get over(): boolean {
    return this.#over
  }

  start(): void {
    this.#resultA = null
    this.#resultB = null
    this.#over = false
    this.a.start()
    this.b.start()
  }

  /** Deal a new board to both players and reopen the match. */
  redeal(preset: PresetId, random: Random): void {
    const deal = dealBoard(preset, random, 1)
    this.#resultA = null
    this.#resultB = null
    this.#over = false
    this.a.redeal({ ...deal, board: cloneBoard(deal.board) })
    this.b.redeal({ ...deal, board: cloneBoard(deal.board) })
  }

  destroy(): void {
    this.a.destroy()
    this.b.destroy()
  }

  /** The session for a player, so the scene can wire one board per side. */
  session(player: PlayerId): PuzzleSession {
    return player === 1 ? this.a : this.b
  }

  #onDone(player: PlayerId, e: { outcome: Outcome; movesUsed: number }): void {
    if (this.#over) return
    const session = this.session(player)
    const result: RaceResult = {
      outcome: e.outcome,
      movesUsed: e.movesUsed,
      owned: session.owned,
    }
    if (player === 1) this.#resultA = result
    else this.#resultB = result
    this.events.emit('playerDone', { player, result })

    const a = this.#resultA
    const b = this.#resultB
    if (!a || !b) return
    this.#over = true
    this.events.emit('matchOver', { winner: resolveRace(a, b), a, b })
  }
}
