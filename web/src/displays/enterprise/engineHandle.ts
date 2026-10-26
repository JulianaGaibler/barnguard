/**
 * The enterprise display's running engine, for work outside the game screen
 * that renders through it, such as print labels. `GameScreen` publishes the
 * engine as soon as it exists and clears it when the engine goes, including
 * across the remount after a lost WebGPU device.
 */
import { get, writable } from 'svelte/store'
import type { Engine } from 'stargazer'

export const enterpriseEngine = writable<Engine | null>(null)

/** How long {@link whenEngine} waits by default before it gives up. */
const ENGINE_WAIT_MS = 10_000

/**
 * The running engine, waiting for one when there is none yet, as during boot or
 * a backend remount. Rejects after `timeoutMs`, which only happens when no GPU
 * backend comes up at all.
 */
export function whenEngine(timeoutMs = ENGINE_WAIT_MS): Promise<Engine> {
  const current = get(enterpriseEngine)
  if (current) return Promise.resolve(current)
  return new Promise((resolve, reject) => {
    let unsubscribe: (() => void) | null = null
    const timer = setTimeout(() => {
      unsubscribe?.()
      reject(new Error(`no enterprise engine after ${timeoutMs} ms`))
    }, timeoutMs)
    unsubscribe = enterpriseEngine.subscribe((engine) => {
      if (!engine) return
      clearTimeout(timer)
      // The first call runs inside `subscribe`, before it returns.
      queueMicrotask(() => unsubscribe?.())
      resolve(engine)
    })
  })
}
