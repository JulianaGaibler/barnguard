/**
 * Standard AbortError construction, matches what `AbortSignal.throwIfAborted()`
 * and `fetch` throw so `err.name === 'AbortError'` checks stay consistent.
 *
 * @category Animation
 */
export function abortError(): DOMException {
  return new DOMException('Aborted', 'AbortError')
}

/**
 * True when `err` is an AbortError produced by the engine or the platform.
 *
 * @category Animation
 */
export function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError'
}

/**
 * Swallow an AbortError, rethrow anything else. Idiomatic use:
 *
 * Await node.tween({ alpha: 0 }, { duration: 0.3 }).catch(ignoreAbort)
 *
 * @category Animation
 */
export function ignoreAbort(err: unknown): void {
  if (isAbortError(err)) return
  throw err
}

/**
 * Result of `combineAbortSignals`, the caller MUST `dispose()` on completion.
 *
 * @category Animation
 */
export interface CombinedAbort {
  readonly signal: AbortSignal
  dispose(): void
}

/**
 * Combine any number of source AbortSignals into one that aborts when any
 * source aborts. Unlike `AbortSignal.any(…)`, the returned handle exposes an
 * explicit `dispose()`, call it on natural completion to remove the listeners
 * we attached to the sources. This is the piece that keeps hours-of-play tween
 * loops from leaking listeners on long-lived node abort signals.
 *
 * @category Animation
 */
export function combineAbortSignals(
  ...signals: Array<AbortSignal | undefined | null>
): CombinedAbort {
  const sources: AbortSignal[] = []
  for (const s of signals) if (s) sources.push(s)
  if (sources.length === 0) {
    // No sources, return a signal that never aborts.
    return { signal: new AbortController().signal, dispose: NOOP }
  }
  if (sources.length === 1) {
    // Pass-through, no wiring, no cleanup needed.
    return { signal: sources[0], dispose: NOOP }
  }
  const controller = new AbortController()

  // Fast-path: if any source is already aborted, propagate immediately and
  // return without wiring listeners.
  for (const s of sources) {
    if (s.aborted) {
      controller.abort(s.reason)
      return { signal: controller.signal, dispose: NOOP }
    }
  }

  const handlers: Array<[AbortSignal, () => void]> = []
  let disposed = false
  const dispose = (): void => {
    if (disposed) return
    disposed = true
    for (const [s, h] of handlers) s.removeEventListener('abort', h)
    handlers.length = 0
  }
  for (const s of sources) {
    const h = (): void => {
      if (!controller.signal.aborted) controller.abort(s.reason)
      dispose()
    }
    s.addEventListener('abort', h, { once: true })
    handlers.push([s, h])
  }
  return { signal: controller.signal, dispose }
}

const NOOP = (): void => {}
