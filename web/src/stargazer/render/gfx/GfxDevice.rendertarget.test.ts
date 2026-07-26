import { describe, it, expect } from 'vitest'
import { MockGfxDevice } from './webgl2/mockGfxDevice'

// Phase 6 seam growth: RenderTargetOpts gains an opt-in depth-stencil
// attachment (3D passes). 2D leaves it off, so the default must not request it.
describe('GfxDevice render-target depth attachment', () => {
  it('defaults to no depth attachment', () => {
    const device = new MockGfxDevice()
    const rt = device.createRenderTarget({ width: 64, height: 64 })
    expect((rt as unknown as { hasDepth: boolean }).hasDepth).toBe(false)
  })

  it('attaches depth when requested', () => {
    const device = new MockGfxDevice()
    const rt = device.createRenderTarget({
      width: 64,
      height: 64,
      samples: 4,
      depth: true,
    })
    expect((rt as unknown as { hasDepth: boolean }).hasDepth).toBe(true)
    expect(rt.samples).toBe(4)
  })
})
