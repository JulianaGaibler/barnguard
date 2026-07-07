/**
 * TypeScript mirror of the printer-daemon's wire DTOs. Kept in sync by hand
 * with `printer-daemon/src/types.rs`; both use `camelCase` field names and the
 * same `snake_case` enum string values.
 */

/** Printer state string values (match Rust `PrinterState`). */
export type PrinterState =
  | 'idle'
  | 'busy'
  | 'printing'
  | 'feeding'
  | 'cutting'
  | 'awaiting_removal'
  | 'no_media'
  | 'sleeping'
  | 'unknown'

/** Job lifecycle string values (match Rust `JobState`). */
export type JobState =
  | 'queued'
  | 'printing'
  | 'cutting'
  | 'awaiting_removal'
  | 'done'
  | 'failed'
  | 'canceled'

export interface JobMeta {
  stateId?: string
  score?: number
  highScore: boolean
  source?: string
}

export interface PrintJob {
  id: string
  state: JobState
  createdAtMs: number
  updatedAtMs: number
  error?: string
  warning?: string
  attempts: number
  meta: JobMeta
}

export interface PrinterStatus {
  reachable: boolean
  state: PrinterState
  printJobError?: string
  tapeRemainingMm?: number
  tapeWidthMm?: number
  model?: string
  serial?: string
  backend: string
  lastSeenMs: number
  /** When the printer first became unreachable (epoch ms); absent while reachable. */
  unreachableSinceMs?: number
  /** Consecutive failed status polls since the last success. */
  failedAttempts?: number
}

export interface QueueSnapshot {
  active: PrintJob | null
  pending: PrintJob[]
  recent: PrintJob[]
}

/** `GET /status` response. */
export interface StatusResponse {
  printer: PrinterStatus
  queueLength: number
  active: PrintJob | null
}

/** Metadata sent alongside a print job (becomes query params). */
export interface PrintMeta {
  stateId?: string
  score?: number
  highScore?: boolean
  source?: string
}

export type LogLevel = 'info' | 'warn' | 'error'

/** One operator-facing message from the daemon's log ring. */
export interface LogEntry {
  tsMs: number
  level: LogLevel
  source: string
  message: string
}
