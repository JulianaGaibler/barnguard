import { describe, expect, it } from 'vitest'
import { summarizePrintStatus, type PrintStatusInput } from './printStatus'
import type { JobState, PrintJob, PrinterStatus } from './types'

const PRINTER: PrinterStatus = {
  reachable: true,
  state: 'idle',
  backend: 'mock',
  lastSeenMs: 0,
}

function job(state: JobState, error?: string): PrintJob {
  return {
    id: `job-${state}`,
    state,
    createdAtMs: 0,
    updatedAtMs: 0,
    attempts: 1,
    error,
    meta: { highScore: false },
  }
}

function input(patch: Partial<PrintStatusInput> = {}): PrintStatusInput {
  return {
    connection: 'online',
    printer: PRINTER,
    active: null,
    pending: [],
    recent: [],
    mockPrinting: false,
    ...patch,
  }
}

describe('summarizePrintStatus', () => {
  it('reads ready when idle with nothing queued', () => {
    expect(summarizePrintStatus(input())).toEqual({
      tone: 'ok',
      label: 'Printer ready',
    })
  })

  it('names the active job and counts the jobs behind it', () => {
    const summary = summarizePrintStatus(
      input({ active: job('printing'), pending: [job('queued')] }),
    )
    expect(summary).toEqual({
      tone: 'busy',
      label: 'Printing',
      detail: '1 queued',
    })
  })

  it('warns when a label waits to be taken', () => {
    const summary = summarizePrintStatus(
      input({ active: job('awaiting_removal') }),
    )
    expect(summary.tone).toBe('warn')
    expect(summary.label).toBe('Remove label')
  })

  it('puts missing tape ahead of the active job', () => {
    const summary = summarizePrintStatus(
      input({
        printer: { ...PRINTER, state: 'no_media' },
        active: job('printing'),
        pending: [job('queued')],
      }),
    )
    expect(summary).toEqual({
      tone: 'error',
      label: 'Load tape',
      detail: '2 queued',
    })
  })

  it('reports an unreachable printer and a lost server', () => {
    expect(
      summarizePrintStatus(input({ printer: { ...PRINTER, reachable: false } }))
        .label,
    ).toBe('Printer offline')
    expect(summarizePrintStatus(input({ connection: 'offline' })).label).toBe(
      'Print server offline',
    )
    expect(summarizePrintStatus(input({ connection: 'connecting' })).tone).toBe(
      'busy',
    )
  })

  it('keeps a failed last print up until the next job', () => {
    const failed = input({ recent: [job('done'), job('failed', 'no_media')] })
    expect(summarizePrintStatus(failed)).toEqual({
      tone: 'error',
      label: 'Last print failed',
      detail: 'no_media',
    })
    const after = input({ recent: [job('failed'), job('done')] })
    expect(summarizePrintStatus(after).label).toBe('Printer ready')
  })

  it('says so when prints skip the printer', () => {
    expect(
      summarizePrintStatus(
        input({ connection: 'offline', mockPrinting: true }),
      ),
    ).toEqual({ tone: 'warn', label: 'Mock printing' })
  })
})
