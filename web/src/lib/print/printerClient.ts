/**
 * Typed client for the printer-daemon HTTP + SSE API, plus a Svelte store
 * (`printerLive`) that mirrors the live queue/printer status over SSE.
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

/**
 * Daemon base URL. Empty string → same-origin (dev uses the Vite proxy for
 * `/api/printer`; prod sets `VITE_PRINTER_DAEMON_URL` to the daemon origin).
 */
const BASE: string = import.meta.env.VITE_PRINTER_DAEMON_URL ?? ''
const API = `${BASE}/api/printer`

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
  const res = await fetch(`${API}/print?${params.toString()}`, {
    method: 'POST',
    headers: { 'content-type': 'image/jpeg' },
    body: jpeg,
  })
  return jsonOrThrow(res)
}

export async function getStatus(): Promise<StatusResponse> {
  return jsonOrThrow(await fetch(`${API}/status`))
}

export async function getQueue(): Promise<QueueSnapshot> {
  return jsonOrThrow(await fetch(`${API}/queue`))
}

export async function cancelJob(id: string): Promise<void> {
  const res = await fetch(`${API}/jobs/${id}/cancel`, { method: 'POST' })
  if (!res.ok) throw new Error(`cancel failed: ${res.status}`)
}

export async function reprintJob(id: string): Promise<{ jobId: string }> {
  return jsonOrThrow(
    await fetch(`${API}/jobs/${id}/reprint`, { method: 'POST' }),
  )
}

export async function clearQueue(): Promise<{ cleared: number }> {
  return jsonOrThrow(await fetch(`${API}/queue/clear`, { method: 'POST' }))
}

/** Ask the daemon to attempt an immediate printer reconnect + status poll. */
export async function reconnect(): Promise<void> {
  const res = await fetch(`${API}/reconnect`, { method: 'POST' })
  if (!res.ok) throw new Error(`reconnect failed: ${res.status}`)
}

/** Fetch the recent buffered log entries (oldest → newest). */
export async function getLog(): Promise<LogEntry[]> {
  return jsonOrThrow(await fetch(`${API}/log`))
}

/** Mock-backend fault injection (no-op against the real printer). */
export async function debugMock(body: {
  forceNoMedia?: boolean
  forceAwaitingRemoval?: boolean
  clearAwaitingRemoval?: boolean
  forceUnreachable?: boolean
}): Promise<void> {
  await fetch(`${API}/debug/mock`, {
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
  /** Whether the SSE connection is currently open. */
  connected: boolean
}

const EMPTY_LIVE: PrinterLiveState = {
  printer: null,
  active: null,
  pending: [],
  recent: [],
  logs: [],
  connected: false,
}

/** How many recent log entries the client keeps for the panel. */
const LOG_RETAIN = 25

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

/**
 * Live printer + queue state over SSE. One shared `EventSource` is opened on
 * the first subscriber and closed when the last unsubscribes (the `readable`
 * stop function), so toggling the attendant panel never leaks connections.
 */
export const printerLive: Readable<PrinterLiveState> = readable<PrinterLiveState>(
  EMPTY_LIVE,
  (set) => {
    // No EventSource in SSR/test; stay in the empty (disconnected) state.
    if (typeof EventSource === 'undefined') {
      return () => {}
    }

    let state = EMPTY_LIVE
    const update = (patch: Partial<PrinterLiveState>): void => {
      state = { ...state, ...patch }
      set(state)
    }

    const es = new EventSource(`${API}/events`)

    es.addEventListener('status', (e) => {
      update({ printer: JSON.parse(e.data) as PrinterStatus, connected: true })
    })
    es.addEventListener('queue', (e) => {
      const q = JSON.parse(e.data) as QueueSnapshot
      update({ active: q.active, pending: q.pending, recent: q.recent })
    })
    es.addEventListener('job', (e) => {
      state = applyJob(state, JSON.parse(e.data) as PrintJob)
      set(state)
    })
    es.addEventListener('log', (e) => {
      const entry = JSON.parse(e.data) as LogEntry
      update({ logs: [...state.logs, entry].slice(-LOG_RETAIN) })
    })
    // Clear on (re)connect so the history the daemon backfills isn't duplicated
    // if the SSE connection dropped and auto-reconnected.
    es.onopen = () => update({ connected: true, logs: [] })
    es.onerror = () => update({ connected: false })

    return () => es.close()
  },
)
