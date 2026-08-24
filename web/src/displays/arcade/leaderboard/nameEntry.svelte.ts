/**
 * The leaderboard entry flow behind a game-over card: fetch the board, decide
 * whether the run earns a row, hold the name the player types, and submit it
 * exactly once however the card goes away.
 *
 * Only the part that must not drift lives here. The card's markup stays with
 * whoever renders it, because the layouts genuinely differ: most games show a
 * centred column, Data Control shows a pair of cards side by side.
 */
import {
  fetchLeaderboard,
  submitScore,
  type LeaderboardEntry,
} from '@src/core/leaderboard/leaderboardClient'

/** Rows the board keeps. A run below the last of them earns nothing. */
const MAX_ROWS = 50

/** Rows shown either side of the pending entry in the card's mini-list. */
export const CONTEXT_ROWS = 2

/** The server truncates past this, so the keyboard stops there too. */
export const NAME_MAX_LEN = 6

export type NameEntryStage = 'loading' | 'unavailable' | 'closed' | 'entering'

export interface NameEntryOptions {
  /** The board's `display` key, from the game's `leaderboards.ts`. */
  display: string
  /** The run's score. Undefined or zero skips the flow entirely. */
  score?: number
  /**
   * Called with whatever name was typed, or `''`, at the moment the entry is
   * settled. A game attaches the name to its own log record here, and can
   * return that write so it is waited on alongside the score.
   */
  onFinalize?: (name: string) => void | Promise<unknown>
}

export class NameEntry {
  readonly #display: string
  readonly #score: number | undefined
  readonly #onFinalize: NameEntryOptions['onFinalize']
  #saved = false

  stage = $state<NameEntryStage>('loading')
  entries = $state<LeaderboardEntry[]>([])
  name = $state('')
  keyboardOpen = $state(false)

  constructor({ display, score, onFinalize }: NameEntryOptions) {
    this.#display = display
    this.#score = score
    this.#onFinalize = onFinalize
  }

  /**
   * While the keyboard is open, spell out every letter slot ("YAI___") so
   * typing progress reads clearly. Closed, the plain name does.
   */
  get pending(): string | undefined {
    return this.keyboardOpen
      ? this.name.toUpperCase().padEnd(NAME_MAX_LEN, '_')
      : undefined
  }

  /** Fetch the board and settle {@link stage}. Call once, from `onMount`. */
  start(): void {
    const score = this.#score
    if (score === undefined || score <= 0) {
      this.stage = 'closed'
      return
    }
    fetchLeaderboard(this.#display, MAX_ROWS)
      .then((list) => {
        this.entries = list
        const qualifies =
          list.length < MAX_ROWS || score > list[MAX_ROWS - 1].score
        this.stage = qualifies ? 'entering' : 'closed'
      })
      .catch(() => {
        this.stage = 'unavailable'
      })
  }

  /**
   * Settle the entry, at most once.
   *
   * An arrow property, so it can be handed straight to `registerExitTask`.
   * Every path out of the card runs it: the two buttons, the arcade-wide swipe
   * escape, the idle reset, and the unmount that follows any of them. The guard
   * is what makes that safe.
   */
  save = async (): Promise<void> => {
    if (this.#saved) return
    this.#saved = true
    const logged = this.#onFinalize?.(this.name)
    const score = this.#score
    const posted =
      this.stage === 'entering' && this.name && score !== undefined
        ? submitScore(this.#display, this.name, score).catch(() => {})
        : undefined
    await Promise.all([logged, posted])
  }
}
