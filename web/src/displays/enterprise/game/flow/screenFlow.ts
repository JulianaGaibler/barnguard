/**
 * Which of the five screens the player is on, and how they move between them.
 *
 * This is the player-facing layer. The session keeps its own finer states for
 * camera moves and the round loop, and the flow only says what the UI shows and
 * what a tap may do.
 */

export type ScreenState =
  'splash' | 'select' | 'selected' | 'playing' | 'gameOver'

export type ScreenEvent =
  | 'play'
  | 'pick'
  | 'back'
  | 'start'
  | 'ended'
  | 'continue'
  | 'again'
  | 'idle'
  | 'abort'

const TRANSITIONS: Readonly<
  Record<ScreenState, Partial<Record<ScreenEvent, ScreenState>>>
> = {
  splash: { play: 'select' },
  select: { pick: 'selected', back: 'splash', idle: 'splash' },
  selected: {
    pick: 'selected',
    back: 'select',
    start: 'playing',
    idle: 'splash',
  },
  playing: { ended: 'gameOver', abort: 'splash' },
  gameOver: {
    continue: 'splash',
    again: 'selected',
    abort: 'splash',
    idle: 'splash',
  },
}

/**
 * How long each screen that falls back to the splash waits without a touch. The
 * game over screen waits longest, since a player may be reading the board or
 * typing a name.
 */
export const IDLE_RETURN_MS: Readonly<Partial<Record<ScreenState, number>>> = {
  select: 90_000,
  selected: 90_000,
  gameOver: 150_000,
}

/** How long before the return the screen warns that it is coming. */
export const IDLE_WARN_MS = 15_000

/** The timer calls the flow uses, replaceable so a test can drive time. */
export interface FlowClock {
  set(fn: () => void, ms: number): unknown
  clear(handle: unknown): void
}

const realClock: FlowClock = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
}

export class ScreenFlow {
  readonly #listeners = new Set<
    (next: ScreenState, prev: ScreenState) => void
  >()
  readonly #warningListeners = new Set<(warning: boolean) => void>()
  readonly #clock: FlowClock
  readonly #idleMs: Readonly<Partial<Record<ScreenState, number>>>
  readonly #warnMs: number
  #state: ScreenState = 'splash'
  #idleHandle: unknown = null
  #warnHandle: unknown = null
  #warning = false

  constructor(
    clock: FlowClock = realClock,
    idleMs: Readonly<Partial<Record<ScreenState, number>>> = IDLE_RETURN_MS,
    warnMs: number = IDLE_WARN_MS,
  ) {
    this.#clock = clock
    this.#idleMs = idleMs
    this.#warnMs = warnMs
  }

  get state(): ScreenState {
    return this.#state
  }

  /** Whether the idle return is close enough to warn about. */
  get warning(): boolean {
    return this.#warning
  }

  /** Whether `event` is legal on the current screen. */
  can(event: ScreenEvent): boolean {
    return TRANSITIONS[this.#state][event] !== undefined
  }

  /**
   * Apply `event`. Returns `false` and changes nothing when it is not legal
   * here, so a stray tap or a late timer is harmless. A legal event that lands
   * on the same screen (retargeting a pick) still restarts the idle clock but
   * does not notify listeners.
   */
  send(event: ScreenEvent): boolean {
    const next = TRANSITIONS[this.#state][event]
    if (next === undefined) return false
    const prev = this.#state
    this.#state = next
    this.#armIdle()
    if (next !== prev) for (const fn of [...this.#listeners]) fn(next, prev)
    return true
  }

  /** Call on any touch so an active player is not sent back to the splash. */
  touch(): void {
    if (this.#idleMs[this.#state] !== undefined) this.#armIdle()
  }

  onChange(fn: (next: ScreenState, prev: ScreenState) => void): () => void {
    this.#listeners.add(fn)
    return () => this.#listeners.delete(fn)
  }

  /** Hear when the idle warning starts and stops. */
  onWarning(fn: (warning: boolean) => void): () => void {
    this.#warningListeners.add(fn)
    return () => this.#warningListeners.delete(fn)
  }

  destroy(): void {
    this.#disarmIdle()
    this.#listeners.clear()
    this.#warningListeners.clear()
  }

  #armIdle(): void {
    this.#disarmIdle()
    const ms = this.#idleMs[this.#state]
    if (ms === undefined) return
    this.#warnHandle = this.#clock.set(
      () => {
        this.#warnHandle = null
        this.#setWarning(true)
      },
      Math.max(0, ms - this.#warnMs),
    )
    this.#idleHandle = this.#clock.set(() => {
      this.#idleHandle = null
      this.send('idle')
    }, ms)
  }

  #disarmIdle(): void {
    if (this.#idleHandle !== null) this.#clock.clear(this.#idleHandle)
    if (this.#warnHandle !== null) this.#clock.clear(this.#warnHandle)
    this.#idleHandle = null
    this.#warnHandle = null
    this.#setWarning(false)
  }

  #setWarning(warning: boolean): void {
    if (warning === this.#warning) return
    this.#warning = warning
    for (const fn of [...this.#warningListeners]) fn(warning)
  }
}
