import { describe, it, expect } from 'vitest'
import { MockGfxDevice } from './webgl2/mockGfxDevice'
import { depthStencilFormatOf } from './depthStencil'

// The depth-stencil attachment is opt-in, for 3D passes. A pure-2D target must
// never allocate one, so the default has to stay off.
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

  it('carries depth and stencil together when both are requested', () => {
    const device = new MockGfxDevice()
    const rt = device.createRenderTarget({
      width: 64,
      height: 64,
      depth: true,
      stencil: true,
    })
    expect(rt.hasDepth).toBe(true)
    expect(rt.hasStencil).toBe(true)
    expect(depthStencilFormatOf(rt)).toBe('depth-stencil')
  })

  it('reports no stencil on a sampleable depth attachment', () => {
    // The G-buffer's depth is a sampleable depth-only texture on both backends,
    // so stencil bits asked for alongside it are never allocated.
    const device = new MockGfxDevice()
    const rt = device.createRenderTarget({
      width: 64,
      height: 64,
      depth: true,
      depthSampled: true,
      stencil: true,
    })
    expect(rt.hasStencil).toBe(false)
    expect(depthStencilFormatOf(rt)).toBe('depth')
  })
})
