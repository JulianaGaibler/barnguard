/**
 * One line on the printer and its queue, for the attendant's corner pill. The
 * most urgent condition wins, so the line always names what needs a hand
 * first.
 */

import type { ConnectionState } from './printerClient'
import type { JobState, PrintJob, PrinterStatus } from './types'

/** `'ok'` only when nothing is printing and nothing needs a hand. */
export type PrintStatusTone = 'ok' | 'busy' | 'warn' | 'error'

export interface PrintStatusSummary {
  tone: PrintStatusTone
  label: string
  /** Secondary text, such as how many jobs wait behind the active one. */
  detail?: string
}

export interface PrintStatusInput {
  connection: ConnectionState
  printer: PrinterStatus | null
  active: PrintJob | null
  pending: readonly PrintJob[]
  /** Finished jobs, oldest first. */
  recent: readonly PrintJob[]
  mockPrinting: boolean
}

const ACTIVE_LABEL: Record<JobState, string> = {
  queued: 'Starting print',
  printing: 'Printing',
  cutting: 'Cutting',
  awaiting_removal: 'Remove label',
  done: 'Printed',
  failed: 'Print failed',
  canceled: 'Canceled',
}

function queuedDetail(count: number): string | undefined {
  return count > 0 ? `${count} queued` : undefined
}

export function summarizePrintStatus(
  input: PrintStatusInput,
): PrintStatusSummary {
  if (input.mockPrinting) return { tone: 'warn', label: 'Mock printing' }
  if (input.connection !== 'online') {
    return input.connection === 'connecting'
      ? { tone: 'busy', label: 'Connecting' }
      : { tone: 'error', label: 'Print server offline' }
  }
  const { printer, active, pending } = input
  if (!printer) return { tone: 'busy', label: 'Connecting' }
  if (!printer.reachable) {
    // Over USB, a sleeping printer drops off the bus and only its button
    // wakes it.
    const hint = printer.backend === 'usb' ? 'press power button' : undefined
    const queued = queuedDetail(pending.length + (active ? 1 : 0))
    return {
      tone: 'error',
      label: 'Printer offline',
      detail: [hint, queued].filter(Boolean).join(' · ') || undefined,
    }
  }
  if (printer.state === 'no_media') {
    return {
      tone: 'error',
      label: 'Load tape',
      detail: queuedDetail(pending.length + (active ? 1 : 0)),
    }
  }
  if (active) {
    return {
      tone: active.state === 'awaiting_removal' ? 'warn' : 'busy',
      label: ACTIVE_LABEL[active.state],
      detail: queuedDetail(pending.length),
    }
  }
  if (printer.state === 'awaiting_removal') {
    return { tone: 'warn', label: 'Remove label' }
  }
  const last = input.recent.at(-1)
  if (last?.state === 'failed') {
    return { tone: 'error', label: 'Last print failed', detail: last.error }
  }
  return { tone: 'ok', label: 'Printer ready' }
}
