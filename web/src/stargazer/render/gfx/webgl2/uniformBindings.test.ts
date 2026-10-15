import { describe, expect, it } from 'vitest'
import { UniformBindingCache } from './uniformBindings'

describe('UniformBindingCache', () => {
  it('skips a repeat bind and rebinds when the buffer, range or point changes', () => {
    const cache = new UniformBindingCache()
    const a = {}
    const b = {}
    expect(cache.needsBind(0, a, 0, 64)).toBe(true)
    expect(cache.needsBind(0, a, 0, 64)).toBe(false)
    expect(cache.needsBind(0, a, 256, 64)).toBe(true)
    expect(cache.needsBind(0, a, 256, 32)).toBe(true)
    expect(cache.needsBind(0, b, 256, 32)).toBe(true)
    // Another binding point is tracked on its own.
    expect(cache.needsBind(1, b, 256, 32)).toBe(true)
    expect(cache.needsBind(0, b, 256, 32)).toBe(false)
  })

  it('binds again after clear, as after a lost context', () => {
    const cache = new UniformBindingCache()
    const a = {}
    cache.needsBind(2, a, 0, -1)
    cache.clear()
    expect(cache.needsBind(2, a, 0, -1)).toBe(true)
  })
})
