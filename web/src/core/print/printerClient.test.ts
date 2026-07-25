import { get } from 'svelte/store'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  enqueuePrint,
  lastMockPrint,
  mockPrintEnabled,
  setMockPrintEnabled,
} from './printerClient'

describe('enqueuePrint', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({ jobId: 'abc' }),
      })),
    )
  })
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs the JPEG body with metadata in the query string', async () => {
    const blob = new Blob(['x'], { type: 'image/jpeg' })
    const res = await enqueuePrint(blob, {
      stateId: 'BW',
      score: 42,
      highScore: true,
      source: 'game',
    })
    expect(res.jobId).toBe('abc')

    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toContain('/api/printer/print?')
    expect(String(url)).toContain('stateId=BW')
    expect(String(url)).toContain('score=42')
    expect(String(url)).toContain('highScore=true')
    expect(String(url)).toContain('source=game')
    expect(init.method).toBe('POST')
    expect(init.headers['content-type']).toBe('image/jpeg')
    expect(init.body).toBe(blob)
  })

  it('throws on a non-ok response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 500, statusText: 'Boom' })),
    )
    const blob = new Blob(['x'], { type: 'image/jpeg' })
    await expect(enqueuePrint(blob, {})).rejects.toThrow()
  })
})

describe('mock printing', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })
  afterEach(() => {
    setMockPrintEnabled(false)
    vi.unstubAllGlobals()
  })

  it('skips the daemon and publishes to lastMockPrint when enabled', async () => {
    setMockPrintEnabled(true)
    expect(get(mockPrintEnabled)).toBe(true)

    const blob = new Blob(['x'], { type: 'image/jpeg' })
    const res = await enqueuePrint(blob, { source: 'game', score: 7 })

    expect(res.jobId).toBe('mock')
    expect(fetch).not.toHaveBeenCalled()

    const mock = get(lastMockPrint)
    expect(mock?.jpeg).toBe(blob)
    expect(mock?.meta).toEqual({ source: 'game', score: 7 })
  })

  it('leaves the real print path untouched when disabled', async () => {
    setMockPrintEnabled(false)
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({ jobId: 'real' }),
      })),
    )
    const blob = new Blob(['x'], { type: 'image/jpeg' })
    const res = await enqueuePrint(blob, {})
    expect(res.jobId).toBe('real')
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})
