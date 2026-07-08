/**
 * Tests for the SSE connection state machine inside `printerClient.ts`.
 *
 * Stubs `EventSource` and `fetch` at the module boundary; each test drives the
 * mock EventSource through open/error/message events and asserts the resulting
 * `printerLive.connection` transitions.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { get } from 'svelte/store'

// ---------------------------------------------------------------------------
// Mock EventSource
// ---------------------------------------------------------------------------

class MockEventSource {
  static instances: MockEventSource[] = []
  static latest(): MockEventSource {
    const inst = MockEventSource.instances.at(-1)
    if (!inst) throw new Error('no EventSource created yet')
    return inst
  }

  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSED = 2

  readyState = MockEventSource.CONNECTING
  onopen: (() => void) | null = null
  onerror: (() => void) | null = null
  onmessage: ((e: MessageEvent) => void) | null = null
  private listeners = new Map<string, ((e: MessageEvent) => void)[]>()
  readonly url: string
  closed = false

  constructor(url: string) {
    this.url = url
    MockEventSource.instances.push(this)
  }

  addEventListener(name: string, handler: (e: MessageEvent) => void): void {
    const arr = this.listeners.get(name) ?? []
    arr.push(handler)
    this.listeners.set(name, arr)
  }

  close(): void {
    this.closed = true
    this.readyState = MockEventSource.CLOSED
  }

  // Test-driver helpers ----------------------------------------------------
  fireOpen(): void {
    this.readyState = MockEventSource.OPEN
    this.onopen?.()
  }
  fireError(): void {
    // Do NOT change readyState — mirrors the "stuck in CONNECTING" case that
    // the Vite proxy 502 hits. The state machine must not depend on it.
    this.onerror?.()
  }
  fireEvent(name: string, data: unknown): void {
    const arr = this.listeners.get(name) ?? []
    const e = new MessageEvent(name, { data: JSON.stringify(data) })
    for (const h of arr) h(e)
  }
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

let unsubscribe: (() => void) | null = null
type PrinterClient = typeof import('./printerClient')
let mod: PrinterClient

async function reloadModule(): Promise<PrinterClient> {
  vi.resetModules()
  return (await import('./printerClient')) as PrinterClient
}

async function subscribeFresh(): Promise<PrinterClient> {
  const m = await reloadModule()
  // Kick off the readable start function by attaching a subscriber. The
  // teardown in `afterEach` unsubscribes so the readable's stop function runs
  // between tests and the EventSource is properly closed.
  unsubscribe = m.printerLive.subscribe(() => {})
  return m
}

beforeEach(() => {
  MockEventSource.instances.length = 0
  vi.stubGlobal('EventSource', MockEventSource)
  vi.useFakeTimers()
})

afterEach(() => {
  unsubscribe?.()
  unsubscribe = null
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('printerLive SSE state machine', () => {
  it('starts in `connecting`, transitions to `online` on onopen', async () => {
    mod = await subscribeFresh()
    expect(get(mod.printerLive).connection).toBe('connecting')

    MockEventSource.latest().fireOpen()
    expect(get(mod.printerLive).connection).toBe('online')
  })

  it('transitions to `offline` and schedules a reopen on onerror — even when readyState stays CONNECTING', async () => {
    mod = await subscribeFresh()
    const first = MockEventSource.latest()
    first.fireOpen()
    expect(get(mod.printerLive).connection).toBe('online')

    // Simulate the Vite-proxy-502 case: onerror fires while readyState is
    // still CONNECTING (browser is retrying internally, but never gives up
    // cleanly). Our machine should NOT wait for CLOSED — it must flip to
    // offline + tear down + schedule a fresh reopen unconditionally.
    first.fireError()
    expect(get(mod.printerLive).connection).toBe('offline')
    expect(first.closed).toBe(true) // we closed the stale socket ourselves

    // 1s later, a fresh EventSource is created.
    vi.advanceTimersByTime(1000)
    expect(MockEventSource.instances.length).toBe(2)
    expect(get(mod.printerLive).connection).toBe('connecting')
  })

  it('doubles the backoff on repeated failures, capped at 15 s', async () => {
    mod = await subscribeFresh()
    // 1st fail → next attempt in 1s
    MockEventSource.latest().fireError()
    vi.advanceTimersByTime(999)
    expect(MockEventSource.instances.length).toBe(1)
    vi.advanceTimersByTime(1)
    expect(MockEventSource.instances.length).toBe(2)

    // 2nd fail → next attempt in 2s
    MockEventSource.latest().fireError()
    vi.advanceTimersByTime(1999)
    expect(MockEventSource.instances.length).toBe(2)
    vi.advanceTimersByTime(1)
    expect(MockEventSource.instances.length).toBe(3)

    // 3rd fail → next attempt in 4s
    MockEventSource.latest().fireError()
    vi.advanceTimersByTime(3999)
    expect(MockEventSource.instances.length).toBe(3)
    vi.advanceTimersByTime(1)
    expect(MockEventSource.instances.length).toBe(4)

    // Skip ahead to the cap. The 4th attempt is in flight; fail it and then
    // fail once more to reach 16s → capped at 15s.
    MockEventSource.latest().fireError() // 8s
    vi.advanceTimersByTime(8000)
    expect(MockEventSource.instances.length).toBe(5)
    MockEventSource.latest().fireError() // would be 16s → capped to 15s
    vi.advanceTimersByTime(14999)
    expect(MockEventSource.instances.length).toBe(5)
    vi.advanceTimersByTime(1)
    expect(MockEventSource.instances.length).toBe(6)
  })

  it('resets backoff to 1 s on a successful onopen', async () => {
    mod = await subscribeFresh()
    // Fail twice → backoff at 2s.
    MockEventSource.latest().fireError()
    vi.advanceTimersByTime(1000)
    MockEventSource.latest().fireError()
    vi.advanceTimersByTime(2000)
    expect(MockEventSource.instances.length).toBe(3)

    // Succeed.
    MockEventSource.latest().fireOpen()
    expect(get(mod.printerLive).connection).toBe('online')

    // Fail again — next attempt should be in 1s (reset), not 4s.
    MockEventSource.latest().fireError()
    vi.advanceTimersByTime(999)
    expect(MockEventSource.instances.length).toBe(3)
    vi.advanceTimersByTime(1)
    expect(MockEventSource.instances.length).toBe(4)
  })

  it('forceReopenSse tears down the current socket and reopens immediately, resetting backoff', async () => {
    mod = await subscribeFresh()
    MockEventSource.latest().fireOpen()

    // Escalate the backoff.
    MockEventSource.latest().fireError()
    vi.advanceTimersByTime(1000)
    MockEventSource.latest().fireError()
    vi.advanceTimersByTime(2000)
    MockEventSource.latest().fireError()
    vi.advanceTimersByTime(4000)
    expect(MockEventSource.instances.length).toBe(4)

    // Force reopen: closes the current attempt (in flight), creates a fresh one.
    const before = MockEventSource.instances.length
    mod.forceReopenSse()
    expect(MockEventSource.instances.length).toBe(before + 1)
    expect(get(mod.printerLive).connection).toBe('connecting')

    // Now the backoff is reset — next fail schedules 1s again.
    MockEventSource.latest().fireError()
    vi.advanceTimersByTime(999)
    expect(MockEventSource.instances.length).toBe(before + 1)
    vi.advanceTimersByTime(1)
    expect(MockEventSource.instances.length).toBe(before + 2)
  })

  it('heartbeat timeout forces a reopen when no message has arrived in 20 s', async () => {
    mod = await subscribeFresh()
    MockEventSource.latest().fireOpen()
    // Time = 0. Heartbeat ticks every 5s; a message resets `lastMessageAt`.
    // Advance 15s → no timeout yet.
    vi.advanceTimersByTime(15_000)
    expect(get(mod.printerLive).connection).toBe('online')
    expect(MockEventSource.instances.length).toBe(1)

    // Advance past 20s total silence → timeout fires on the next 5s tick.
    vi.advanceTimersByTime(10_000) // total 25s
    // The tick at t=20s ran the timeout check; scheduleReopen was called.
    expect(get(mod.printerLive).connection).toBe('offline')
    // The next EventSource opens after the (now-reset since force is not
    // used here) backoff — the timeout path uses `scheduleReopen`, so it goes
    // through the backoff timer.
    // Since we've been failing implicitly, backoff is 1s.
    vi.advanceTimersByTime(1000)
    expect(MockEventSource.instances.length).toBe(2)
  })

  it('any inbound event bumps the heartbeat, preventing timeout', async () => {
    mod = await subscribeFresh()
    MockEventSource.latest().fireOpen()

    // Send a `status` event every 10s for 60s. Heartbeat should never trip.
    for (let t = 10_000; t <= 60_000; t += 10_000) {
      vi.advanceTimersByTime(10_000)
      MockEventSource.latest().fireEvent('status', {
        reachable: true,
        state: 'idle',
        backend: 'mock',
        lastSeenMs: 0,
      })
    }
    expect(get(mod.printerLive).connection).toBe('online')
    expect(MockEventSource.instances.length).toBe(1)
  })

  it('robustFetch: network error flips connection to offline and schedules a reopen', async () => {
    mod = await subscribeFresh()
    MockEventSource.latest().fireOpen()
    expect(get(mod.printerLive).connection).toBe('online')

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch')
      }),
    )
    await expect(mod.robustFetch('/does-not-matter')).rejects.toThrow()
    expect(get(mod.printerLive).connection).toBe('offline')
  })

  it('robustFetch: 2xx while offline force-reopens the SSE immediately', async () => {
    mod = await subscribeFresh()
    // Fail the initial connection so we're in offline.
    MockEventSource.latest().fireError()
    expect(get(mod.printerLive).connection).toBe('offline')
    const before = MockEventSource.instances.length

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, status: 200 })),
    )
    await mod.robustFetch('/ping')
    // A new EventSource was created immediately, bypassing the backoff timer.
    expect(MockEventSource.instances.length).toBe(before + 1)
    expect(get(mod.printerLive).connection).toBe('connecting')
  })

  it('robustFetch: 4xx does not touch the connection state', async () => {
    mod = await subscribeFresh()
    MockEventSource.latest().fireOpen()

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 404, statusText: 'nf' })),
    )
    await mod.robustFetch('/gone')
    expect(get(mod.printerLive).connection).toBe('online')
  })
})
