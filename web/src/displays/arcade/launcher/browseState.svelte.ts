/**
 * What someone browsing the launcher has set up: the filters they narrowed the
 * carousel with, and the card they scrolled to.
 *
 * It lives outside `Launcher.svelte` because the component is destroyed while a
 * game runs. Someone shopping for a game dips into two or three of them before
 * settling, and rebuilding the shortlist after each one is the friction this
 * avoids.
 *
 * The leaderboard and AI filters exclude each other: turning one on turns the
 * other off. No game both keeps scores and plays against the machine, so the
 * two together can only ever empty the carousel. Player counts are free to
 * combine with either. That pairing does have empty combinations of its own
 * (the games with an AI opponent seat one or two), which is what the launcher's
 * "nothing matches" screen is for.
 */
import { SvelteSet } from 'svelte/reactivity'

/**
 * How long a game runs before the launcher forgets the visitor who started it.
 *
 * Long enough to cover backing straight out of a game that turned out not to
 * appeal, short enough that anyone who played a round is treated as gone by the
 * time the next person walks up.
 */
export const BROWSE_STATE_HOLD_MS = 60_000

class BrowseState {
  readonly #counts = new SvelteSet<number>()
  #leaderboardOnly = $state(false)
  #aiOnly = $state(false)

  /** Carousel offset in px, reapplied when the launcher comes back. */
  scrollLeft = $state(0)

  #expiry: ReturnType<typeof setTimeout> | undefined

  /** Player counts kept. Empty means no constraint. */
  get counts(): ReadonlySet<number> {
    return this.#counts
  }

  /** Whether the carousel is down to games that keep a leaderboard. */
  get leaderboardOnly(): boolean {
    return this.#leaderboardOnly
  }

  /** Whether the carousel is down to games with an AI opponent. */
  get aiOnly(): boolean {
    return this.#aiOnly
  }

  /**
   * Keep or drop one player count. Counts read as "either", so several at once
   * widen the carousel rather than narrowing it.
   */
  toggleCount(n: number): void {
    if (!this.#counts.delete(n)) this.#counts.add(n)
  }

  toggleLeaderboard(): void {
    this.#leaderboardOnly = !this.#leaderboardOnly
    if (this.#leaderboardOnly) this.#aiOnly = false
  }

  toggleAi(): void {
    this.#aiOnly = !this.#aiOnly
    if (this.#aiOnly) this.#leaderboardOnly = false
  }

  /** Back to how the launcher opens. */
  clear(): void {
    this.#counts.clear()
    this.#leaderboardOnly = false
    this.#aiOnly = false
    this.scrollLeft = 0
  }

  /**
   * Hold this for a visitor who has just started a game, and drop it once that
   * game has run past {@link BROWSE_STATE_HOLD_MS}.
   */
  startExpiry(): void {
    this.cancelExpiry()
    this.#expiry = setTimeout(() => this.clear(), BROWSE_STATE_HOLD_MS)
  }

  /** The launcher is back on screen, so whoever set this is still here. */
  cancelExpiry(): void {
    clearTimeout(this.#expiry)
    this.#expiry = undefined
  }
}

export const browseState = new BrowseState()
