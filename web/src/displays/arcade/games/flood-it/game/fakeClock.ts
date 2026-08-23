/**
 * A stand-in for the engine's clock, for testing the sessions.
 *
 * The sessions reach for exactly one engine facility, `engine.wait`, to hold
 * through the deal-in sweep and the turn handoff. Handing them a clock the test
 * advances by hand keeps the state machines verifiable without a canvas, and
 * keeps the tests free of real timers.
 */
import { abortError, type EngineHost } from '@src/stargazer'

interface FakeClock {
  host: EngineHost
  /** Resolve every outstanding wait and let the continuations run. */
  advance(): Promise<void>
  /** How many waits are outstanding. */
  readonly pending: number
  /**
   * Every duration asked for, in order.
   *
   * Waits resolve on demand here rather than on a clock, so this is the only
   * way to check the pacing a caller intended.
   */
  readonly waits: readonly number[]
}

export function fakeClock(): FakeClock {
  let waiters: Array<() => void> = []
  const waits: number[] = []

  const wait = (sec: number, signal?: AbortSignal): Promise<void> =>
    new Promise<void>((resolve, reject) => {
      waits.push(sec)
      if (signal?.aborted) {
        reject(abortError())
        return
      }
      waiters.push(resolve)
      signal?.addEventListener('abort', () => reject(abortError()), {
        once: true,
      })
    })

  return {
    host: { engine: { wait } } as unknown as EngineHost,
    waits,
    get pending() {
      return waiters.length
    },
    async advance() {
      const batch = waiters
      waiters = []
      for (const resolve of batch) resolve()
      // A resolved wait continues on a microtask, and a session may chain
      // another await behind it, so drain a few turns rather than one.
      for (let i = 0; i < 8; i++) await Promise.resolve()
    },
  }
}
