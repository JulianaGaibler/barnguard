import { describe, expect, it, vi } from 'vitest'
import { GpuGfx } from './GpuGfx'
import { MockGfxDevice } from './webgl2/mockGfxDevice'

async function makeGfx(): Promise<{ gfx: GpuGfx; device: MockGfxDevice }> {
  const canvas = document.createElement('canvas')
  canvas.width = 400
  canvas.height = 300
  const device = new MockGfxDevice()
  const gfx = new GpuGfx(canvas, device, { stencil: true })
  await gfx.whenReady
  device.reset()
  return { gfx, device }
}

function frame(gfx: GpuGfx, draw: () => void): void {
  gfx.beginFrame({
    clearColor: '#000000',
    transparent: false,
    pixelW: 400,
    pixelH: 300,
  })
  gfx.setBaseTransform(1, 0, 0, 1, 0, 0)
  gfx.setAlpha(1)
  draw()
  gfx.endFrame()
}

describe('ring growth', () => {
  it('records every run when a frame needs more uniform slices than the initial ring', async () => {
    const { gfx, device } = await makeGfx()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const runs = 5000
    frame(gfx, () => {
      for (let i = 0; i < runs; i++) {
        // Alternating blend breaks the batch, so each fill is its own run with
        // its own uniform slice.
        gfx.setBlend(i % 2 === 0 ? 'source-over' : 'lighter')
        gfx.fillRect(i % 300, 0, 4, 4, '#ff0000')
      }
    })
    expect(warn).not.toHaveBeenCalled()
    warn.mockRestore()
    expect(device.draws).toHaveLength(runs)
    expect(device.passes).toHaveLength(1)
    // Per-run slices are staged and sent in one write per ring, not one write
    // per draw.
    expect(device.uniformUploads.length).toBeLessThan(10)
    // Recorded draws name the replaced rings until the frame is submitted.
    expect(device.deletedUniformBuffers).toBe(0)
    frame(gfx, () => gfx.fillRect(0, 0, 4, 4, '#ff0000'))
    expect(device.deletedUniformBuffers).toBeGreaterThan(0)
  })

  it('keeps one pass when a stream outgrows its initial buffer', async () => {
    const { gfx, device } = await makeGfx()
    frame(gfx, () => {
      for (let i = 0; i < 30000; i++) gfx.fillRect(i % 300, 0, 4, 4, '#00ff00')
    })
    expect(device.passes).toHaveLength(1)
    expect(device.draws.length).toBeGreaterThan(0)
    expect(device.deletedBuffers.length).toBeGreaterThan(0)
  })
})
