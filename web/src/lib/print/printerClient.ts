/**
 * Typed client for the printer-daemon HTTP + SSE API. `printerLive` mirrors
 * queue/printer status over one EventSource per subscription cycle.
 *
 * Connection state machine (`connecting → online → offline`):
 * - Retries on ANY `onerror`, never checks `readyState`. Vite's proxy 502
 *   stalls the EventSource in `CONNECTING`, so a `CLOSED` check would never
 *   fire.
 * - 5 s heartbeat tick, reopen if no named event arrives in 25 s. The
 *   daemon's `ping` event fires every 15 s. Its comment keep-alive is
 *   byte-level only, browsers don't dispatch comment lines to EventSource
 *   handlers, so we can't observe them.
 * - Exponential backoff 1 → 15 s, resets on `onopen` or `forceReopen`.
 */

import { readable, type Readable } from 'svelte/store'
import type {
  LogEntry,
  PrintJob,
  PrintMeta,
  PrinterStatus,
  QueueSnapshot,
  StatusResponse,
} from './types'
import type { GameRecord } from '@src/lib/gameLogClient'
import { setDaemonConfig, type DaemonConfig } from '@src/stores/daemonConfig'

/**
 * Daemon base URL. Empty = same-origin (dev via Vite proxy). Prod sets
 * `VITE_PRINTER_DAEMON_URL` to the daemon origin.
 */
const BASE: string = import.meta.env.VITE_PRINTER_DAEMON_URL ?? ''
const API = `${BASE}/api/printer`

/** Client-side connection state for the SSE stream. */
export type ConnectionState = 'online' | 'connecting' | 'offline'

/**
 * Hooks the fetch layer and Reconnect button use to nudge SSE state without
 * cross-imports. Null when no subscriber is attached.
 */
let signalBackendUnreachable: (() => void) | null = null
let signalBackendMaybeUp: (() => void) | null = null
let sseForceReopen: (() => void) | null = null

/**
 * `fetch` wrapper that keeps SSE state in sync with HTTP liveness.
 * - Network error or 5xx nudges SSE offline and kicks the retry loop early.
 * - 2xx force-reopens the SSE if it's currently offline.
 * - 4xx is a business error, connection state untouched.
 */
export async function robustFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  let res: Response
  try {
    res = await fetch(input, init)
  } catch (e) {
    signalBackendUnreachable?.()
    throw e
  }
  if (res.status >= 500) {
    signalBackendUnreachable?.()
  } else if (res.ok) {
    signalBackendMaybeUp?.()
  }
  return res
}

async function jsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    throw new Error(`printer request failed: ${res.status} ${res.statusText}`)
  }
  return (await res.json()) as T
}

/** Enqueue a print job. The JPEG is sent as the raw request body. */
export async function enqueuePrint(
  jpeg: Blob,
  meta: PrintMeta,
): Promise<{ jobId: string }> {
  const params = new URLSearchParams()
  if (meta.stateId) params.set('stateId', meta.stateId)
  if (meta.score !== undefined) params.set('score', String(meta.score))
  if (meta.highScore !== undefined)
    params.set('highScore', String(meta.highScore))
  if (meta.source) params.set('source', meta.source)
  const res = await robustFetch(`${API}/print?${params.toString()}`, {
    method: 'POST',
    headers: { 'content-type': 'image/jpeg' },
    body: jpeg,
  })
  return jsonOrThrow(res)
}

export async function getStatus(): Promise<StatusResponse> {
  return jsonOrThrow(await robustFetch(`${API}/status`))
}

export async function getQueue(): Promise<QueueSnapshot> {
  return jsonOrThrow(await robustFetch(`${API}/queue`))
}

export async function cancelJob(id: string): Promise<void> {
  const res = await robustFetch(`${API}/jobs/${id}/cancel`, { method: 'POST' })
  if (!res.ok) throw new Error(`cancel failed: ${res.status}`)
}

export async function reprintJob(id: string): Promise<{ jobId: string }> {
  return jsonOrThrow(
    await robustFetch(`${API}/jobs/${id}/reprint`, { method: 'POST' }),
  )
}

export async function clearQueue(): Promise<{ cleared: number }> {
  return jsonOrThrow(
    await robustFetch(`${API}/queue/clear`, { method: 'POST' }),
  )
}

/**
 * Nudge the daemon to reconnect to the printer, and force-reopen the SSE.
 * Two-fer for the "try everything" Reconnect button. Force-reopen runs even
 * if the POST fails so recovery is instant when the daemon returns.
 */
export async function reconnect(): Promise<void> {
  try {
    const res = await robustFetch(`${API}/reconnect`, { method: 'POST' })
    if (!res.ok) throw new Error(`reconnect failed: ${res.status}`)
  } finally {
    // Kick the SSE regardless of the POST result.
    forceReopenSse()
  }
}

/**
 * Force an immediate SSE reopen, bypassing backoff and resetting it to 1 s.
 * Safe on an already-online stream (tears down + reconnects). No-op before
 * any subscriber is attached.
 */
export function forceReopenSse(): void {
  sseForceReopen?.()
}

/**
 * Ask the daemon to re-read `config.toml`. The daemon broadcasts the new
 * effective config over SSE, `daemonConfig` updates on its own.
 */
export async function reloadConfig(): Promise<void> {
  const res = await robustFetch(`${API}/config/reload`, { method: 'POST' })
  if (!res.ok) throw new Error(`config reload failed: ${res.status}`)
}

/**
 * In-memory label-URL override, supersedes `config.toml` until reset. Daemon
 * echoes new config over SSE. Escape hatch for last-minute changes.
 */
export async function setLabelUrlOverride(labelUrl: string): Promise<void> {
  const res = await robustFetch(`${API}/config/override`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ labelUrl }),
  })
  if (!res.ok) throw new Error(`set label URL override failed: ${res.status}`)
}

/** Clear the label-URL override, reverting to the daemon's `config.toml` value. */
export async function resetLabelUrlOverride(): Promise<void> {
  const res = await robustFetch(`${API}/config/override`, { method: 'DELETE' })
  if (!res.ok) throw new Error(`reset label URL override failed: ${res.status}`)
}

/** Fetch the recent buffered log entries (oldest → newest). */
export async function getLog(): Promise<LogEntry[]> {
  return jsonOrThrow(await robustFetch(`${API}/log`))
}

/** Mock-backend fault injection (no-op against the real printer). */
export async function debugMock(body: {
  forceNoMedia?: boolean
  forceAwaitingRemoval?: boolean
  clearAwaitingRemoval?: boolean
  forceUnreachable?: boolean
}): Promise<void> {
  await robustFetch(`${API}/debug/mock`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export interface PrinterLiveState {
  printer: PrinterStatus | null
  active: PrintJob | null
  pending: PrintJob[]
  recent: PrintJob[]
  /** Recent daemon log messages, oldest → newest. */
  logs: LogEntry[]
  /**
   * SSE state. `'connecting'` = trying (first attempt or mid-session retry).
   * `'offline'` = gave up on the current socket, waiting on backoff timer.
   */
  connection: ConnectionState
  /** Full game log, newest-first. Fed by the same SSE stream. */
  games: GameRecord[]
}

const EMPTY_LIVE: PrinterLiveState = {
  printer: null,
  active: null,
  pending: [],
  recent: [],
  logs: [],
  connection: 'connecting',
  games: [],
}

/** Recent-log ring size on the client side. */
const LOG_RETAIN = 25

/** SSE backoff bounds + heartbeat window. */
const BACKOFF_INITIAL_MS = 1_000
const BACKOFF_MAX_MS = 15_000
const HEARTBEAT_TICK_MS = 5_000
/**
 * No named event in this long = dead. Must exceed the daemon's 15 s `ping`
 * cadence with headroom for jitter. Two back-to-back missed pings still
 * trip it. SSE comment keep-alives don't dispatch, only named events count.
 */
const HEARTBEAT_TIMEOUT_MS = 25_000

function applyJob(state: PrinterLiveState, job: PrintJob): PrinterLiveState {
  const replace = (list: PrintJob[]): PrintJob[] =>
    list.map((j) => (j.id === job.id ? job : j))
  return {
    ...state,
    active: state.active && state.active.id === job.id ? job : state.active,
    pending: replace(state.pending),
    recent: replace(state.recent),
  }
}

export const printerLive: Readable<PrinterLiveState> =
  readable<PrinterLiveState>(EMPTY_LIVE, (set) => {
    // SSR / vitest without a DOM: stay in the empty state, no timers.
    if (typeof EventSource === 'undefined') {
      return () => {}
    }

    let state = EMPTY_LIVE
    const update = (patch: Partial<PrinterLiveState>): void => {
      state = { ...state, ...patch }
      set(state)
    }

    let es: EventSource | null = null
    let retryTimer: ReturnType<typeof setTimeout> | null = null
    let heartbeatTimer: ReturnType<typeof setInterval> | null = null
    let lastMessageAtMs = 0
    let backoffMs = BACKOFF_INITIAL_MS
    let stopped = false

    const bumpHeartbeat = (): void => {
      lastMessageAtMs = Date.now()
    }

    const stopHeartbeat = (): void => {
      if (heartbeatTimer !== null) {
        clearInterval(heartbeatTimer)
        heartbeatTimer = null
      }
    }

    const startHeartbeat = (): void => {
      stopHeartbeat()
      heartbeatTimer = setInterval(() => {
        if (Date.now() - lastMessageAtMs > HEARTBEAT_TIMEOUT_MS) {
          // Silent stall — no error, no ping, nothing. Reopen the socket.
          scheduleReopen()
        }
      }, HEARTBEAT_TICK_MS)
    }

    const teardownEs = (): void => {
      stopHeartbeat()
      if (es) {
        es.close()
        es = null
      }
    }

    const scheduleReopen = (): void => {
      if (stopped) return
      teardownEs()
      if (state.connection !== 'offline') update({ connection: 'offline' })
      if (retryTimer !== null) return
      const delay = backoffMs
      retryTimer = setTimeout(() => {
        retryTimer = null
        backoffMs = Math.min(backoffMs * 2, BACKOFF_MAX_MS)
        open()
      }, delay)
    }

    const forceReopen = (): void => {
      if (stopped) return
      if (retryTimer !== null) {
        clearTimeout(retryTimer)
        retryTimer = null
      }
      backoffMs = BACKOFF_INITIAL_MS
      open()
    }

    const open = (): void => {
      if (stopped) return
      teardownEs()
      update({ connection: 'connecting' })
      bumpHeartbeat()
      startHeartbeat()

      const newEs = new EventSource(`${API}/events`)
      es = newEs

      const listen = <T>(name: string, apply: (value: T) => void): void => {
        newEs.addEventListener(name, (e) => {
          bumpHeartbeat()
          apply(JSON.parse((e as MessageEvent).data) as T)
        })
      }

      listen<PrinterStatus>('status', (p) => update({ printer: p }))
      listen<QueueSnapshot>('queue', (q) =>
        update({ active: q.active, pending: q.pending, recent: q.recent }),
      )
      listen<PrintJob>('job', (job) => {
        state = applyJob(state, job)
        set(state)
      })
      listen<LogEntry>('log', (entry) => {
        update({ logs: [...state.logs, entry].slice(-LOG_RETAIN) })
      })
      // Daemon config lives in its own store, `onopen`'s log-clear doesn't
      // touch it. Default persists until the first snapshot arrives.
      listen<DaemonConfig>('config', (c) => setDaemonConfig(c))
      // Game log: server sends `games` (full snapshot, oldest → newest) once
      // on connect, then `game.created` / `game.deleted` incrementally.
      listen<GameRecord[]>('games', (list) => {
        update({ games: [...list].reverse() })
      })
      listen<GameRecord>('game.created', (rec) => {
        if (state.games.some((g) => g.id === rec.id)) return
        update({ games: [rec, ...state.games] })
      })
      newEs.addEventListener('game.deleted', (e) => {
        bumpHeartbeat()
        const id = String((e as MessageEvent).data ?? '').trim()
        if (!id) return
        update({ games: state.games.filter((g) => g.id !== id) })
      })
      // Daemon keep-alive. Payload ignored, receipt alone is proof of life.
      // Body isn't JSON so bypass `listen`.
      newEs.addEventListener('ping', () => bumpHeartbeat())
      newEs.onmessage = () => bumpHeartbeat()

      newEs.onopen = () => {
        bumpHeartbeat()
        backoffMs = BACKOFF_INITIAL_MS
        // Clear logs on (re)open so the daemon's backfill isn't duplicated.
        update({ connection: 'online', logs: [] })
      }
      newEs.onerror = () => {
        // Unconditional retry, never checks `readyState`. Vite's proxy 502
        // leaves EventSource stuck in `CONNECTING` forever.
        scheduleReopen()
      }
    }

    // Wire up the fetch-layer hooks.
    signalBackendUnreachable = (): void => {
      // Fetch failed → daemon is very likely dead; drop the SSE and start the
      // backoff loop right away instead of waiting for `onerror`.
      if (state.connection !== 'offline') scheduleReopen()
    }
    signalBackendMaybeUp = (): void => {
      // 2xx = daemon alive. Only kick a reopen if we've given up; during
      // 'connecting' interrupting would churn the fresh socket.
      if (state.connection === 'offline') forceReopen()
    }
    sseForceReopen = forceReopen

    open()

    return () => {
      stopped = true
      signalBackendUnreachable = null
      signalBackendMaybeUp = null
      sseForceReopen = null
      if (retryTimer !== null) clearTimeout(retryTimer)
      retryTimer = null
      teardownEs()
    }
  })
