/**
 * A stand-in for the engine's clock, for testing the session and the match.
 *
 * The session reaches for exactly one engine facility, `engine.wait`, to hold
 * the flash before a cleared row collapses. Everything else it does runs off
 * the `dt` handed to `Session.step`. Between the two, a test drives the whole
 * state machine with no canvas and no real timers.
 */
import { abortError, type EngineHost } from '@src/stargazer'

export interface FakeClock {
  host: EngineHost
  /** Resolve every outstanding wait and let the continuations run. */
  advance(): Promise<void>
  /** How many waits are outstanding. */
  readonly pending: number
  /** Every duration asked for, in order, which is the only record of pacing. */
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
      // A resolved wait continues on a microtask and the session chains another
      // behind it, so drain a few turns rather than one.
      for (let i = 0; i < 8; i++) await Promise.resolve()
    },
  }
}
