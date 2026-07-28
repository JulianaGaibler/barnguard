import { describe, expect, it } from 'vitest'
import { DebugLine3DRenderer } from './DebugLine3DRenderer'
import { MockGfxDevice } from './webgl2/mockGfxDevice'
import type { PipelineDesc } from './GfxDevice'
import { mat4 } from '../../math/Mat4'

const TARGET = { format: 'linear' as const, samples: 1 }

/** Drain microtasks until the renderer's pipelines have warmed. */
async function ready(r: DebugLine3DRenderer): Promise<void> {
  for (let i = 0; i < 50 && !r.ready; i++) await Promise.resolve()
}

function depthTest(pipeline: unknown): boolean {
  return (pipeline as { desc: PipelineDesc }).desc.depth!.test
}

describe('DebugLine3DRenderer', () => {
  it('draws nothing when no segments were pushed', async () => {
    const device = new MockGfxDevice()
    const r = new DebugLine3DRenderer(device, TARGET)
    await ready(r)
    r.begin()
    r.flush(mat4())
    expect(device.draws.filter((d) => d.kind === 'lines')).toHaveLength(0)
  })

  it('draws an AABB box as 24 line vertices (12 edges), depth-tested, no depth write', async () => {
    const device = new MockGfxDevice()
    const r = new DebugLine3DRenderer(device, TARGET)
    await ready(r)
    r.begin()
    r.box(-1, -1, -1, 1, 1, 1, [1, 1, 1, 1])
    r.flush(mat4())
    const lines = device.draws.filter((d) => d.kind === 'lines')
    expect(lines).toHaveLength(1)
    expect(lines[0].count).toBe(24)
    // Occluded lines depth-test; neither variant writes depth.
    expect(depthTest(lines[0].pipeline)).toBe(true)
    expect(
      (lines[0].pipeline as { desc: PipelineDesc }).desc.depth!.write,
    ).toBe(false)
  })

  it('splits occluded and overlay into two draws with different depth-test state', async () => {
    const device = new MockGfxDevice()
    const r = new DebugLine3DRenderer(device, TARGET)
    await ready(r)
    r.begin()
    r.line(0, 0, 0, 1, 0, 0, [1, 0, 0, 1]) // occluded
    r.line(0, 0, 0, 0, 1, 0, [0, 1, 0, 1], true) // overlay
    r.flush(mat4())
    const lines = device.draws.filter((d) => d.kind === 'lines')
    expect(lines).toHaveLength(2)
    // Occluded run first (2 verts, depth-tested), then overlay (offset past it).
    expect(lines[0].first).toBe(0)
    expect(lines[0].count).toBe(2)
    expect(depthTest(lines[0].pipeline)).toBe(true)
    expect(lines[1].first).toBe(2)
    expect(lines[1].count).toBe(2)
    expect(depthTest(lines[1].pipeline)).toBe(false)
  })

  it('clears segments between frames', async () => {
    const device = new MockGfxDevice()
    const r = new DebugLine3DRenderer(device, TARGET)
    await ready(r)
    r.begin()
    r.line(0, 0, 0, 1, 1, 1, [1, 1, 1, 1])
    r.flush(mat4())
    device.reset()
    r.begin()
    r.flush(mat4())
    expect(device.draws.filter((d) => d.kind === 'lines')).toHaveLength(0)
  })
})
