import { afterEach, describe, expect, it, vi } from 'vitest'
import { LabelPreviewQueue } from './labelPreviewQueue'

/** A render that resolves when the test says so, recording what it drew. */
function harness() {
  const renders: { input: string; variant: string; finish: () => void }[] = []
  const shown: string[] = []
  const closed: string[] = []
  const queue = new LabelPreviewQueue<string, string>({
    render: (input, variant) =>
      new Promise((resolve) => {
        const bitmap = {
          close: () => closed.push(`${input}:${variant}`),
        } as unknown as ImageBitmap
        renders.push({ input, variant, finish: () => resolve(bitmap) })
      }),
    show: (variant) => shown.push(variant),
    pause: () => Promise.resolve(),
  })
  return { queue, renders, shown, closed }
}

const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve()
}

afterEach(() => vi.useRealTimers())

describe('LabelPreviewQueue', () => {
  it('renders the variants in the order given, one at a time', async () => {
    const { queue, renders, shown } = harness()
    queue.request('a', ['purple', 'orange', 'pink'])
    await flush()
    expect(renders.map((r) => r.variant)).toEqual(['purple'])
    renders[0].finish()
    await flush()
    renders[1].finish()
    await flush()
    renders[2].finish()
    await flush()
    expect(shown).toEqual(['purple', 'orange', 'pink'])
  })

  it('drops a stale job and closes the bitmap it no longer needs', async () => {
    const { queue, renders, shown, closed } = harness()
    queue.request('a', ['purple', 'orange'])
    await flush()
    queue.request('b', ['orange', 'purple'])
    queue.request('c', ['pink'])
    renders[0].finish()
    await flush()
    expect(closed).toEqual(['a:purple'])
    // Only the newest request runs next, never the one it replaced.
    expect(renders.map((r) => r.input)).toEqual(['a', 'c'])
    renders[1].finish()
    await flush()
    expect(shown).toEqual(['pink'])
  })

  it('waits for typing to pause before a debounced request', async () => {
    vi.useFakeTimers()
    const { queue, renders } = harness()
    queue.request('j', ['purple'], { debounce: true })
    queue.request('ju', ['purple'], { debounce: true })
    vi.advanceTimersByTime(100)
    queue.request('jul', ['purple'], { debounce: true })
    vi.advanceTimersByTime(149)
    await flush()
    expect(renders).toHaveLength(0)
    vi.advanceTimersByTime(1)
    await flush()
    expect(renders.map((r) => r.input)).toEqual(['jul'])
  })

  it('shows nothing after it is disposed', async () => {
    const { queue, renders, shown, closed } = harness()
    queue.request('a', ['purple'])
    await flush()
    queue.dispose()
    renders[0].finish()
    await flush()
    expect(shown).toEqual([])
    expect(closed).toEqual(['a:purple'])
    queue.request('b', ['purple'])
    await flush()
    expect(renders).toHaveLength(1)
  })

  it('takes new requests after a cancel', async () => {
    const { queue, renders, shown, closed } = harness()
    queue.request('a', ['purple'])
    await flush()
    queue.cancel()
    renders[0].finish()
    await flush()
    expect(closed).toEqual(['a:purple'])
    queue.request('b', ['purple'])
    await flush()
    renders[1].finish()
    await flush()
    expect(shown).toEqual(['purple'])
  })
})
