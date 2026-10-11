import { describe, it, expect } from 'vitest'
import { GpuGfx } from './GpuGfx'
import { MockGfxDevice } from './webgl2/mockGfxDevice'
import type { GfxShadowStyle } from './Gfx2D'

function makeCanvas(): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = 400
  c.height = 300
  return c
}

function makeGpuGfx(): { gfx: GpuGfx; device: MockGfxDevice } {
  const canvas = makeCanvas()
  const device = new MockGfxDevice()
  const gfx = new GpuGfx(canvas, device)
  return { gfx, device }
}

async function baseFrame(gfx: GpuGfx, device: MockGfxDevice): Promise<void> {
  await gfx.whenReady
  device.reset()
  gfx.beginFrame({
    clearColor: '#0d1a2c',
    transparent: false,
    pixelW: 400,
    pixelH: 300,
  })
  gfx.setBaseTransform(1, 0, 0, 1, 0, 0)
  gfx.setAlpha(1)
}

const shadow = (overrides: Partial<GfxShadowStyle> = {}): GfxShadowStyle => ({
  color: 'rgba(20,16,40,0.35)',
  offsetX: 0,
  offsetY: 8,
  blur: 32,
  spread: 0,
  inset: false,
  ...overrides,
})

describe('GpuGfx analytic shadows', () => {
  it('draws an outset round-rect shadow as one instance, one draw call', async () => {
    const { gfx, device } = makeGpuGfx()
    await baseFrame(gfx, device)
    gfx.shadowRoundRect(50, 50, 200, 120, 16, shadow())
    gfx.endFrame()
    expect(device.draws.length).toBe(1)
    expect(gfx.stats.shadowInstances).toBe(1)
  })

  it('draws an inset round-rect shadow without crashing', async () => {
    const { gfx, device } = makeGpuGfx()
    await baseFrame(gfx, device)
    gfx.shadowRoundRect(50, 50, 200, 120, 16, shadow({ inset: true }))
    gfx.endFrame()
    expect(device.draws.length).toBe(1)
  })

  it('draws a circle shadow without crashing', async () => {
    const { gfx, device } = makeGpuGfx()
    await baseFrame(gfx, device)
    gfx.shadowCircle(100, 100, 40, shadow())
    gfx.endFrame()
    expect(device.draws.length).toBe(1)
  })

  it('handles zero blur (a hard, unblurred shadow) without crashing', async () => {
    const { gfx, device } = makeGpuGfx()
    await baseFrame(gfx, device)
    gfx.shadowRoundRect(0, 0, 100, 60, 8, shadow({ blur: 0 }))
    gfx.endFrame()
    expect(device.draws.length).toBe(1)
  })

  it('handles a blur much larger than the shape without crashing (sigma clamp)', async () => {
    const { gfx, device } = makeGpuGfx()
    await baseFrame(gfx, device)
    gfx.shadowRoundRect(0, 0, 20, 20, 4, shadow({ blur: 500 }))
    gfx.endFrame()
    expect(device.draws.length).toBe(1)
  })

  it('handles negative spread (shrink) without inverting the shape', async () => {
    const { gfx, device } = makeGpuGfx()
    await baseFrame(gfx, device)
    gfx.shadowRoundRect(0, 0, 40, 40, 8, shadow({ spread: -1000 }))
    gfx.endFrame()
    expect(device.draws.length).toBe(1)
  })

  it('multiple shadows on the same instance batch (no gradient, no clip change)', async () => {
    const { gfx, device } = makeGpuGfx()
    await baseFrame(gfx, device)
    gfx.shadowRoundRect(0, 0, 40, 40, 8, shadow())
    gfx.shadowRoundRect(50, 0, 40, 40, 8, shadow())
    gfx.shadowCircle(150, 20, 20, shadow())
    gfx.endFrame()
    expect(device.draws.length).toBe(1)
    expect(gfx.stats.shadowInstances).toBe(3)
  })
})
