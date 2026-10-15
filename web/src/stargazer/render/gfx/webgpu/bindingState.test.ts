import { describe, expect, it } from 'vitest'
import { PassBindingState } from './bindingState'

describe('PassBindingState', () => {
  it('reports a bind only when the buffer, offset, format or offsets differ', () => {
    const s = new PassBindingState<object, object>()
    const vb = {}
    const ib = {}
    const bg = {}
    expect(s.vertexBufferChanged(0, vb, 0)).toBe(true)
    expect(s.vertexBufferChanged(0, vb, 0)).toBe(false)
    expect(s.vertexBufferChanged(0, vb, 64)).toBe(true)
    expect(s.vertexBufferChanged(1, vb, 64)).toBe(true)

    expect(s.indexBufferChanged(ib, 'uint16')).toBe(true)
    expect(s.indexBufferChanged(ib, 'uint16')).toBe(false)
    expect(s.indexBufferChanged(ib, 'uint32')).toBe(true)

    expect(s.bindGroupChanged(1, bg, [256])).toBe(true)
    expect(s.bindGroupChanged(1, bg, [256])).toBe(false)
    expect(s.bindGroupChanged(1, bg, [512])).toBe(true)
    // No offsets and an empty list are the same binding.
    expect(s.bindGroupChanged(0, bg)).toBe(true)
    expect(s.bindGroupChanged(0, bg, [])).toBe(false)
  })

  it('binds everything again after reset, as in a new pass', () => {
    const s = new PassBindingState<object, object>()
    const vb = {}
    const bg = {}
    s.vertexBufferChanged(0, vb, 0)
    s.bindGroupChanged(0, bg)
    s.reset()
    expect(s.vertexBufferChanged(0, vb, 0)).toBe(true)
    expect(s.bindGroupChanged(0, bg)).toBe(true)
  })
})
