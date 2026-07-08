/**
 * Typed client for the printer-daemon HTTP + SSE API, plus a Svelte store
 * (`printerLive`) that mirrors the live queue/printer status over SSE.
 *
 * The SSE stream carries every push the app cares about — printer status, queue
 * snapshots, per-job updates, operator log, and the game log (`games` /
 * `game.created` / `game.deleted`). One `EventSource` per subscription cycle
 * serves all of it.
 *
 * Connection lifecycle: a small state machine drives `printer­Live.connection`
 * through `connecting → online → offline` and back. It:
 *
 * - Retries on ANY `onerror` (never depends on `readyState === CLOSED`, since
 *   Vite's proxy 502s stall the EventSource in `CONNECTING`),
 * - Runs a 5 s heartbeat tick and forces a reopen if no message has arrived in 20
 *   s (the daemon pings every 15 s, so a single miss is fine),
 * - Backs off exponentially (1 → 15 s cap), and
 * - Resets to 1 s on `onopen` or on an operator-triggered `forceReopen` (the
 *   "Reconnect printer" button, or a successful `robustFetch` while the stream
 *   is down — a fresh 2xx proves the daemon is alive).
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
 * Daemon base URL. Empty string → same-origin (dev uses the Vite proxy for
 * `/api/printer`; prod sets `VITE_PRINTER_DAEMON_URL` to the daemon origin).
 */
const BASE: string = import.meta.env.VITE_PRINTER_DAEMON_URL ?? ''
const API = `${BASE}/api/printer`

/** Client-side connection state for the SSE stream. */
export type ConnectionState = 'online' | 'connecting' | 'offline'

/**
 * Hooks registered by `printerLive`'s start function so external code (the HTTP
 * fetch layer, the Reconnect button) can nudge the SSE state without
 * cross-imports. All null before the first subscriber and after the last
 * unsubscribes.
 */
let signalBackendUnreachable: (() => void) | null = null
let signalBackendMaybeUp: (() => void) | null = null
let sseForceReopen: (() => void) | null = null

/**
 * Wraps `fetch` so the SSE state stays in sync with what the HTTP path knows
 * about backend liveness:
 *
 * - Network error or 5xx → treat as "daemon dead", nudge SSE offline + kick the
 *   retry loop early (don't wait for the browser to notice).
 * - 2xx → treat as "daemon alive"; if the SSE is stuck disconnected, force it to
 *   reopen immediately (bridges the "click Reconnect while SSE is dead" case).
 * - 4xx → business error; do not touch connection state. The response is returned
 *   unchanged; callers decide error handling.
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
 * Nudge the daemon to reconnect to the physical printer and poll status
 * immediately. Also forces the client SSE to reopen right away — one button,
 * one mental model ("try everything"). If the daemon is down the POST fails
 * (network error / 5xx via Vite), which `robustFetch` already reflects in the
 * connection state; we still force-reopen so recovery is instant when the
 * daemon returns.
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
 * Force an immediate SSE reopen (bypasses the backoff timer, resets backoff to
 * the base 1 s). Safe to call while the stream is already online — it will
 * still tear down + reconnect. No-op before any subscriber is attached.
 */
export function forceReopenSse(): void {
  sseForceReopen?.()
}

/**
 * Ask the daemon to re-read `config.toml` from disk. The daemon applies the
 * `[client]` values and broadcasts them over SSE, so the update lands in
 * `daemonConfig` on its own — no client-side refetch needed here.
 */
export async function reloadConfig(): Promise<void> {
  const res = await robustFetch(`${API}/config/reload`, { method: 'POST' })
  if (!res.ok) throw new Error(`config reload failed: ${res.status}`)
}

/**
 * Set an in-memory label-URL override on the daemon (supersedes `config.toml`
 * until reset). The daemon echoes the new effective config back over SSE, so
 * `daemonConfig` updates on its own — no refetch here. Escape hatch for
 * changing the printed URL last-minute without editing files.
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
   * SSE state. `'connecting'` covers both the very first attempt and any
   * mid-session retry between failed and successful `open()`s — read it as
   * "trying, not sure yet". `'offline'` means we've given up on the current
   * socket and are waiting on the backoff timer.
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
/** No message in this long → treat as dead. Server pings every 15 s. */
const HEARTBEAT_TIMEOUT_MS = 20_000

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
      // Client-facing daemon config. Sent once in the connect snapshot, then
      // again whenever an operator hits "Reload config". Lives in its own store
      // (not `printerLiveState`); `onopen`'s log-clear doesn't touch it, and the
      // default persists until the first snapshot arrives.
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
      // Keep-alive `ping` and any un-typed message also count as liveness.
      newEs.onmessage = () => bumpHeartbeat()

      newEs.onopen = () => {
        bumpHeartbeat()
        backoffMs = BACKOFF_INITIAL_MS
        // Clear logs on (re)open so the daemon's backfill isn't duplicated.
        update({ connection: 'online', logs: [] })
      }
      newEs.onerror = () => {
        // Unconditional retry — never gate on `readyState`. Vite's proxy 502
        // for a dead upstream leaves EventSource in `CONNECTING` forever, so
        // relying on `CLOSED` means we'd never retry in dev.
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
      // Fetch succeeded → daemon is definitely alive. Only kick a reopen if
      // we've *given up* (offline). During 'connecting' we're already trying,
      // and interrupting would churn the freshly-opened socket on first paint.
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
