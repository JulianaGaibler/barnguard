/**
 * A re-abortable cancellation scope: one long-lived handle that hands out a
 * fresh {@link AbortSignal} per "epoch" and cancels the previous one when a new
 * epoch begins.
 *
 * The motivating case is a game session that runs an async sequence per match
 * (reveal, play, win, return) and must abort whatever is in flight the instant
 * the next match, a reset, or a quit begins. Without a scope, callers track a
 * generation counter by hand and check `if (gen !== current) return` after
 * every `await`. With one, they capture `scope.reset()` at the top of the
 * sequence and let the awaits throw `AbortError` when the epoch ends, so the
 * async function unwinds on its own:
 *
 * ```ts
 * const scope = node.scope()
 * function startMatch(): void {
 *   const signal = scope.reset() // cancels the previous match's in-flight awaits
 *   void (async () => {
 *     await revealOpen(signal)
 *     await playMatch(signal)
 *     await returnToMenu(signal)
 *   })().catch(ignoreAbort) // catch once, at the boundary
 * }
 * ```
 *
 * Optionally bound to a parent signal (see {@link Node2D.scope}): when the
 * parent aborts, the current epoch aborts and the scope disposes itself.
 *
 * @category Animation
 */
export class AbortScope {
  #controller: AbortController
  readonly #parent?: AbortSignal
  #removeParentListener: (() => void) | null = null
  #disposed = false

  /**
   * @param parent Optional signal that, when aborted, aborts the current epoch
   *   and disposes the scope. Used to tie a scope to a node's lifetime.
   */
  constructor(parent?: AbortSignal) {
    this.#parent = parent
    this.#controller = this.#makeController()
  }

  /** The current epoch's signal. Aborted after {@link abort}/{@link dispose}. */
  get signal(): AbortSignal {
    return this.#controller.signal
  }

  /** Whether the current epoch's signal is aborted. */
  get aborted(): boolean {
    return this.#controller.signal.aborted
  }

  /**
   * Abort the current epoch and open a fresh one. Returns the new epoch's
   * signal. Capture the return value at the top of an async sequence so it
   * holds that epoch's signal even after a later `reset()` swaps the current
   * one. A disposed scope returns its (aborted) signal without opening a new
   * epoch.
   */
  reset(): AbortSignal {
    if (this.#disposed) return this.#controller.signal
    this.#abortCurrent()
    this.#controller = this.#makeController()
    return this.#controller.signal
  }

  /**
   * Abort the current epoch and leave it aborted until the next {@link reset}.
   * Use to cancel in-flight work without immediately starting a new epoch.
   */
  abort(): void {
    if (this.#disposed) return
    this.#abortCurrent()
  }

  /** Abort the current epoch and mark the scope unusable. Idempotent. */
  dispose(): void {
    if (this.#disposed) return
    this.#abortCurrent()
    this.#disposed = true
  }

  #abortCurrent(): void {
    this.#removeParentListener?.()
    this.#removeParentListener = null
    if (!this.#controller.signal.aborted) this.#controller.abort()
  }

  #makeController(): AbortController {
    const controller = new AbortController()
    const parent = this.#parent
    if (parent) {
      if (parent.aborted) {
        controller.abort(parent.reason)
        this.#disposed = true
      } else {
        const onAbort = (): void => {
          if (!controller.signal.aborted) controller.abort(parent.reason)
          this.#disposed = true
        }
        parent.addEventListener('abort', onAbort, { once: true })
        this.#removeParentListener = () =>
          parent.removeEventListener('abort', onAbort)
      }
    }
    return controller
  }
}
