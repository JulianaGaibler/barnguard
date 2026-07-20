import { readable, type Readable } from 'svelte/store'
import type { Emitter } from '../events/Emitter'

/**
 * Names of engine events that fire many times per second. Binding one of these
 * to a Svelte store crushes the framerate through re-render churn.
 * `emitterStore` and `latestEventStore` both warn (dev-time) when asked to.
 * Read the value directly via `emitter.on(...)` in a `$effect` (or a manual rAF
 * loop for canvas-driven overlays) instead.
 */
const HIGH_FREQUENCY_EVENT_KEYS = new Set<string>(['frame', 'pointerMove'])

function warnIfHighFrequency(key: PropertyKey): void {
  if (typeof key !== 'string') return
  if (!HIGH_FREQUENCY_EVENT_KEYS.has(key)) return
  console.warn(
    `[stargazer] emitterStore('${key}'): this event is HIGH FREQUENCY. ` +
      `Binding it to a Svelte store fires the reactivity graph on every ` +
      `emission and will crush the framerate. Subscribe with ` +
      `\`emitter.on('${key}', …)\` in a \`$effect\` instead.`,
  )
}

/**
 * Turn a typed emitter key into a Svelte `Readable<M[K]>` that starts at
 * `initial` and updates on every emission. Attaches on first subscriber,
 * detaches on last.
 *
 * @category Svelte
 * @example
 *   const score = emitterStore(session.events, 'score', 0) // {$score} in markup
 */
export function emitterStore<M, K extends keyof M>(
  emitter: Emitter<M>,
  key: K,
  initial: M[K],
): Readable<M[K]> {
  warnIfHighFrequency(key)
  return readable<M[K]>(initial, (set) => {
    return emitter.on(key, (payload) => set(payload))
  })
}

/**
 * Convenience variant for "the payload of the most recent event, or `null`
 * before any has fired". Handy when the store powers a modal that appears on
 * the first event and disappears when the caller resets to `null`.
 *
 * @category Svelte
 */
export function latestEventStore<M, K extends keyof M>(
  emitter: Emitter<M>,
  key: K,
): Readable<M[K] | null> {
  warnIfHighFrequency(key)
  return readable<M[K] | null>(null, (set) => {
    return emitter.on(key, (payload) => set(payload))
  })
}
