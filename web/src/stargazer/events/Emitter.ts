/**
 * Handler for an {@link Emitter} event, called with the event's payload.
 *
 * @category Events
 */
export type EmitterHandler<T> = (payload: T) => void

/**
 * Typed event bus keyed by an event map `M`. Payload types follow the map, so
 * `on` and `emit` are checked against the key. Build one with
 * {@link createEmitter}.
 *
 * @category Events
 */
export interface Emitter<M> {
  /** Subscribe to `key`. Returns an unsubscribe function. */
  on<K extends keyof M>(key: K, handler: EmitterHandler<M[K]>): () => void
  /** Unsubscribe a handler previously passed to `on`. */
  off<K extends keyof M>(key: K, handler: EmitterHandler<M[K]>): void
  /** Dispatch `payload` to every handler registered for `key`. */
  emit<K extends keyof M>(key: K, payload: M[K]): void
}

type AnyHandler = EmitterHandler<unknown>

// Per-key dispatch bookkeeping: reused scratch array + reentrancy depth.
// Allocated lazily on first emit of a given key.
interface KeyState {
  scratch: AnyHandler[]
  depth: number
}

class EmitterImpl<M> implements Emitter<M> {
  readonly #handlers = new Map<keyof M, Set<AnyHandler>>()
  readonly #stateByKey = new Map<keyof M, KeyState>()
  #reentrancyWarnings = 0

  on<K extends keyof M>(key: K, handler: EmitterHandler<M[K]>): () => void {
    let set = this.#handlers.get(key)
    if (!set) {
      set = new Set()
      this.#handlers.set(key, set)
    }
    set.add(handler as AnyHandler)
    return () => {
      this.#handlers.get(key)?.delete(handler as AnyHandler)
    }
  }

  off<K extends keyof M>(key: K, handler: EmitterHandler<M[K]>): void {
    this.#handlers.get(key)?.delete(handler as AnyHandler)
  }

  emit<K extends keyof M>(key: K, payload: M[K]): void {
    const set = this.#handlers.get(key)
    if (!set || set.size === 0) return

    let state = this.#stateByKey.get(key)
    if (!state) {
      state = { scratch: [], depth: 0 }
      this.#stateByKey.set(key, state)
    }

    // Reentrant same-key emit, outer dispatch's scratch is still in use, so
    // fall back to a fresh allocation. Warn (throttled), reentrant emits
    // almost always indicate a handler that emits back to itself.
    if (state.depth > 0) {
      if (this.#reentrancyWarnings < 3) {
        this.#reentrancyWarnings++
        console.warn(
          `[stargazer] Emitter.emit reentrant on key '${String(key)}', ` +
            `a handler emitted the same event during dispatch. depth=${state.depth + 1}. ` +
            `Usually a bug.`,
        )
      }
      const nested: AnyHandler[] = []
      for (const h of set) nested.push(h)
      state.depth++
      try {
        for (let i = 0; i < nested.length; i++) {
          ;(nested[i] as EmitterHandler<M[K]>)(payload)
        }
      } finally {
        state.depth--
      }
      return
    }

    // Steady state: snapshot into the persistent scratch, dispatch, clear.
    // Snapshotting tolerates handlers that call on/off during dispatch.    // those mutations hit `handlers` but not `scratch`, so they take effect
    // on the NEXT emit (the documented contract).
    const scratch = state.scratch
    scratch.length = 0
    for (const h of set) scratch.push(h)
    state.depth++
    try {
      for (let i = 0; i < scratch.length; i++) {
        ;(scratch[i] as EmitterHandler<M[K]>)(payload)
      }
    } finally {
      state.depth--
      // Drop references so garbage-collectable handlers can be reclaimed
      // between emits, otherwise the last emit's set would pin its
      // captured closures indefinitely.
      scratch.length = 0
    }
  }
}

/**
 * Create an {@link Emitter} for the event map `M`.
 *
 * @category Events
 */
export function createEmitter<M>(): Emitter<M> {
  return new EmitterImpl<M>()
}
