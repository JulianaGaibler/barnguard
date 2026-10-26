/**
 * The rules of a run, with no drawing in it. The screen runs the animations and
 * calls in when each one ends, and the session says what comes next.
 *
 * A run goes `splash`, then for each round `entering` (the card is coming in
 * and cannot be voted on yet), `playing` (the clock runs), `reveal` (the answer
 * is showing), and either the next `entering` or `gameover`. A wrong answer and
 * a timeout both end the run.
 */
import type { Algorithm, Level, Rgb } from './contrast'
import { newRound, type Random, type Round } from './round'
import {
  browserStorage,
  loadHighScore,
  saveHighScore,
  type SavedStorage,
} from './storage'

/** Seconds a player has for each round. */
export const ROUND_SECONDS = 10

export type Phase = 'splash' | 'entering' | 'playing' | 'reveal' | 'gameover'

/** A finished round. `pick` is null when the clock ran out. */
export interface RoundResult {
  round: Round
  pick: Level | null
  correct: boolean
}

export interface SessionOptions {
  algorithm: Algorithm
  colors: readonly Rgb[]
  random?: Random
  storage?: SavedStorage | null
}

export class Session {
  #algorithm: Algorithm
  readonly #colors: readonly Rgb[]
  readonly #random: Random
  readonly #storage: SavedStorage | null
  readonly #listeners = new Set<() => void>()
  #upcoming: Round | null = null

  phase: Phase = 'splash'
  /** The card in play, or the one just answered during the reveal. */
  round: Round | null = null
  /** Rounds answered so far, the one on show included once it is revealed. */
  results: RoundResult[] = []
  /**
   * The next card, drawn as soon as an answer is right so the screen can show
   * it waiting while the answer is up. Null until then, and after a wrong
   * answer.
   */
  get upcoming(): Round | null {
    return this.#upcoming
  }

  /** Seconds left on the current round. */
  remaining = ROUND_SECONDS
  /** The best score before this run, set when the run ends. */
  best = 0
  /** True when this run beat the best, set when the run ends. */
  record = false

  constructor(options: SessionOptions) {
    this.#algorithm = options.algorithm
    this.#colors = options.colors
    this.#random = options.random ?? Math.random
    this.#storage =
      options.storage === undefined ? browserStorage() : options.storage
  }

  get algorithm(): Algorithm {
    return this.#algorithm
  }

  /** The number of rounds answered correctly. */
  get score(): number {
    return this.results.filter((r) => r.correct).length
  }

  /** The result of the round just revealed, once there is one. */
  get last(): RoundResult | null {
    return this.results[this.results.length - 1] ?? null
  }

  /** Calls `fn` after every change, and returns the way to stop. */
  subscribe(fn: () => void): () => void {
    this.#listeners.add(fn)
    return () => this.#listeners.delete(fn)
  }

  /** Starts a run from the splash, or again from a game over. */
  start(): void {
    this.#upcoming = null
    this.results = []
    this.record = false
    this.best = 0
    this.#nextRound()
  }

  /** The card has finished coming in, so the clock starts. */
  beginRound(): void {
    if (this.phase !== 'entering') return
    this.phase = 'playing'
    this.remaining = ROUND_SECONDS
    this.#emit()
  }

  /** Advances the clock by `dt` seconds. Ends the round when it reaches zero. */
  tick(dt: number): void {
    if (this.phase !== 'playing') return
    this.remaining = Math.max(0, this.remaining - dt)
    if (this.remaining === 0) this.#answer(null)
    else this.#emit()
  }

  /** The player's answer. Ignored outside a round. */
  vote(level: Level): void {
    if (this.phase !== 'playing') return
    this.#answer(level)
  }

  /**
   * The reveal has been on screen long enough. A right answer goes on to the
   * next card and a wrong one ends the run.
   */
  finishReveal(): void {
    if (this.phase !== 'reveal') return
    if (this.last?.correct) {
      this.#nextRound()
      return
    }
    this.best = loadHighScore(this.#algorithm, this.#storage)
    this.record = saveHighScore(this.#algorithm, this.score, this.#storage)
    if (this.record) this.best = this.score
    this.phase = 'gameover'
    this.#emit()
  }

  /** Back to the splash, forgetting the run. */
  reset(): void {
    this.#upcoming = null
    this.phase = 'splash'
    this.round = null
    this.results = []
    this.record = false
    this.remaining = ROUND_SECONDS
    this.#emit()
  }

  /** Switches algorithm and starts over at the splash. */
  setAlgorithm(algorithm: Algorithm): void {
    this.#algorithm = algorithm
    this.reset()
  }

  #nextRound(): void {
    this.round =
      this.#upcoming ?? newRound(this.#algorithm, this.#colors, this.#random)
    this.#upcoming = null
    this.remaining = ROUND_SECONDS
    this.phase = 'entering'
    this.#emit()
  }

  #answer(pick: Level | null): void {
    const round = this.round
    if (!round) return
    this.results = [
      ...this.results,
      { round, pick, correct: pick === round.level },
    ]
    if (pick === round.level) {
      this.#upcoming = newRound(this.#algorithm, this.#colors, this.#random)
    }
    this.phase = 'reveal'
    this.#emit()
  }

  #emit(): void {
    for (const fn of this.#listeners) fn()
  }
}
