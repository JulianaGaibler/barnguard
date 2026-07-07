import { describe, expect, it } from 'vitest'
import {
  abortError,
  combineAbortSignals,
  ignoreAbort,
  isAbortError,
} from './abortSignal'

describe('isAbortError / ignoreAbort', () => {
  it('detects standard AbortError', () => {
    expect(isAbortError(abortError())).toBe(true)
    expect(isAbortError(new Error('nope'))).toBe(false)
    expect(isAbortError(null)).toBe(false)
    expect(isAbortError({ name: 'AbortError' })).toBe(false)
  })

  it('ignoreAbort swallows AbortError, rethrows others', () => {
    expect(() => ignoreAbort(abortError())).not.toThrow()
    expect(() => ignoreAbort(new Error('kaboom'))).toThrow('kaboom')
  })
})

describe('combineAbortSignals', () => {
  it('returns a never-aborting signal for empty input', () => {
    const { signal } = combineAbortSignals()
    expect(signal.aborted).toBe(false)
  })

  it('passes a single source through unchanged', () => {
    const ctrl = new AbortController()
    const { signal } = combineAbortSignals(ctrl.signal)
    expect(signal).toBe(ctrl.signal)
  })

  it('aborts the combined signal when any source aborts', () => {
    const a = new AbortController()
    const b = new AbortController()
    const { signal } = combineAbortSignals(a.signal, b.signal)
    expect(signal.aborted).toBe(false)
    b.abort()
    expect(signal.aborted).toBe(true)
  })

  it('propagates an already-aborted source immediately', () => {
    const a = new AbortController()
    a.abort()
    const b = new AbortController()
    const { signal } = combineAbortSignals(a.signal, b.signal)
    expect(signal.aborted).toBe(true)
  })

  it('dispose removes listeners on source signals', () => {
    const a = new AbortController()
    const b = new AbortController()
    let added = 0
    let removed = 0
    const origAdd = a.signal.addEventListener.bind(a.signal)
    const origRemove = a.signal.removeEventListener.bind(a.signal)
    a.signal.addEventListener = ((type: string, ...args: unknown[]): void => {
      if (type === 'abort') added++
      return (origAdd as unknown as (...args: unknown[]) => void)(type, ...args)
    }) as typeof a.signal.addEventListener
    a.signal.removeEventListener = ((
      type: string,
      ...args: unknown[]
    ): void => {
      if (type === 'abort') removed++
      return (origRemove as unknown as (...args: unknown[]) => void)(
        type,
        ...args,
      )
    }) as typeof a.signal.removeEventListener

    const { dispose } = combineAbortSignals(a.signal, b.signal)
    expect(added).toBeGreaterThan(0)
    const beforeDispose = added
    dispose()
    expect(removed).toBe(beforeDispose)
  })
})
