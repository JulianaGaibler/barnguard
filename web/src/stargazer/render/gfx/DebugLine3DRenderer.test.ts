import { describe, expect, it } from 'vitest'
import { DebugLine3DRenderer } from './DebugLine3DRenderer'
import { MockGfxDevice } from './webgl2/mockGfxDevice'
import { mat4 } from '../../math/Mat4'

describe('DebugLine3DRenderer', () => {
  it('draws nothing when no segments were pushed', () => {
    const device = new MockGfxDevice()
    const r = new DebugLine3DRenderer(device)
    r.begin()
    r.flush(mat4())
    expect(device.draws.filter((d) => d.kind === 'lines')).toHaveLength(0)
  })

  it('draws an AABB box as 24 line vertices (12 edges), depth-tested, no depth write', () => {
    const device = new MockGfxDevice()
    const r = new DebugLine3DRenderer(device)
    r.begin()
    r.box(-1, -1, -1, 1, 1, 1, [1, 1, 1, 1])
    r.flush(mat4())
    const lines = device.draws.filter((d) => d.kind === 'lines')
    expect(lines).toHaveLength(1)
    expect(lines[0].count).toBe(24)
    expect(device.depthTest).toBe(true)
    expect(device.depthWrite).toBe(false)
    expect(device.cull).toBe('none')
  })

  it('splits occluded and overlay into two draws with different depth-test state', () => {
    const device = new MockGfxDevice()
    const r = new DebugLine3DRenderer(device)
    r.begin()
    r.line(0, 0, 0, 1, 0, 0, [1, 0, 0, 1]) // occluded
    r.line(0, 0, 0, 0, 1, 0, [0, 1, 0, 1], true) // overlay
    r.flush(mat4())
    const lines = device.draws.filter((d) => d.kind === 'lines')
    expect(lines).toHaveLength(2)
    // Occluded run first (2 verts), then overlay run offset past it.
    expect(lines[0].first).toBe(0)
    expect(lines[0].count).toBe(2)
    expect(lines[1].first).toBe(2)
    expect(lines[1].count).toBe(2)
  })

  it('clears segments between frames', () => {
    const device = new MockGfxDevice()
    const r = new DebugLine3DRenderer(device)
    r.begin()
    r.line(0, 0, 0, 1, 1, 1, [1, 1, 1, 1])
    r.flush(mat4())
    device.reset()
    r.begin()
    r.flush(mat4())
    expect(device.draws.filter((d) => d.kind === 'lines')).toHaveLength(0)
  })
})
