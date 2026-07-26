import { describe, expect, it } from 'vitest'
import { AbortScope } from './AbortScope'

describe('AbortScope', () => {
  it('starts with a live (non-aborted) signal', () => {
    const scope = new AbortScope()
    expect(scope.aborted).toBe(false)
    expect(scope.signal.aborted).toBe(false)
  })

  it('reset() aborts the prior epoch and hands out a fresh live signal', () => {
    const scope = new AbortScope()
    const first = scope.signal
    const second = scope.reset()
    expect(first.aborted).toBe(true)
    expect(second.aborted).toBe(false)
    expect(second).not.toBe(first)
    expect(scope.signal).toBe(second)
  })

  it('abort() aborts the current epoch and leaves it aborted until reset()', () => {
    const scope = new AbortScope()
    const sig = scope.signal
    scope.abort()
    expect(sig.aborted).toBe(true)
    expect(scope.aborted).toBe(true)
    const next = scope.reset()
    expect(next.aborted).toBe(false)
  })

  it('dispose() aborts and is idempotent; reset() no longer opens a new epoch', () => {
    const scope = new AbortScope()
    const sig = scope.signal
    scope.dispose()
    expect(sig.aborted).toBe(true)
    expect(() => scope.dispose()).not.toThrow()
    // A disposed scope stays aborted.
    const after = scope.reset()
    expect(after.aborted).toBe(true)
  })

  it('aborts the current epoch when the parent signal aborts', () => {
    const parent = new AbortController()
    const scope = new AbortScope(parent.signal)
    const sig = scope.signal
    expect(sig.aborted).toBe(false)
    parent.abort()
    expect(sig.aborted).toBe(true)
    // Parent abort disposes the scope: no new epochs.
    expect(scope.reset().aborted).toBe(true)
  })

  it('is born aborted when the parent is already aborted', () => {
    const parent = new AbortController()
    parent.abort()
    const scope = new AbortScope(parent.signal)
    expect(scope.aborted).toBe(true)
  })

  it('rewires the parent listener across resets (new epoch still aborts)', () => {
    const parent = new AbortController()
    const scope = new AbortScope(parent.signal)
    const second = scope.reset()
    expect(second.aborted).toBe(false)
    parent.abort()
    expect(second.aborted).toBe(true)
  })
})
