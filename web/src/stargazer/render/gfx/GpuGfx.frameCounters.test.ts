import { describe, expect, it } from 'vitest'
import { GpuGfx } from './GpuGfx'
import { MockGfxDevice } from './webgl2/mockGfxDevice'

describe('GpuGfx frame counters', () => {
  it('counts device work done before and after the frame, then starts over', async () => {
    const canvas = document.createElement('canvas')
    canvas.width = 400
    canvas.height = 300
    const device = new MockGfxDevice()
    const gfx = new GpuGfx(canvas, device, { stencil: true, samples: 1 })
    await gfx.whenReady
    gfx.captureFrameCounters()

    // A pass ahead of the frame, as the shadow and AO passes are.
    device.beginRenderPass({ color: { target: gfx.target, loadOp: 'clear' } })
    device.endRenderPass()
    gfx.beginFrame({
      clearColor: '#000000',
      transparent: false,
      pixelW: 400,
      pixelH: 300,
    })
    gfx.endFrame()
    gfx.captureFrameCounters()
    expect(gfx.stats.framePasses).toBe(2)
    expect(gfx.stats.frameSubmits).toBe(1)

    gfx.beginFrame({
      clearColor: '#000000',
      transparent: false,
      pixelW: 400,
      pixelH: 300,
    })
    gfx.endFrame()
    gfx.captureFrameCounters()
    expect(gfx.stats.framePasses).toBe(1)
  })
})
