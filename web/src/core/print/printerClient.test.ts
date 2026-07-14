import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { enqueuePrint } from './printerClient'

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
