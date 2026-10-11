import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { GpuGfx } from './GpuGfx'
import { MockGfxDevice } from './webgl2/mockGfxDevice'
import type { GfxLinearGradient } from './Gfx2D'

// happy-dom's OffscreenCanvas has no real 2D context. Stub a minimal one so
// the ramp builder reaches the texture-cache logic under test (same stub as
// TextureManager.gradientAtlas.test.ts).
let getCtxSpy: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  getCtxSpy = vi.spyOn(OffscreenCanvas.prototype, 'getContext').mockReturnValue(
    {
      createLinearGradient: () => ({ addColorStop: () => {} }),
      fillStyle: '',
      fillRect: () => {},
    } as never,
  )
})
afterEach(() => {
  getCtxSpy.mockRestore()
})

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

const ramp = (): GfxLinearGradient => ({
  kind: 'linear',
  x0: 0,
  y0: 0,
  x1: 0,
  y1: 100,
  stops: [
    { offset: 0, color: '#1d1d2b' },
    { offset: 1, color: '#3a2d5c' },
  ],
})

describe('GpuGfx gradient fills', () => {
  it('draws a gradient fillRect without crashing, as one draw call', async () => {
    const { gfx, device } = makeGpuGfx()
    await baseFrame(gfx, device)
    gfx.fillRect(0, 0, 100, 100, ramp())
    gfx.endFrame()
    expect(device.draws.length).toBe(1)
    expect(device.draws[0].count).toBe(6)
  })

  it('a solid fill after a gradient fill breaks the batch (does not inherit its DrawParams)', async () => {
    const { gfx, device } = makeGpuGfx()
    await baseFrame(gfx, device)
    gfx.fillRect(0, 0, 100, 100, ramp())
    gfx.fillRect(0, 0, 10, 10, '#ff0000')
    gfx.endFrame()
    // Two coloredTri runs: the gradient run and the solid run, each with its
    // own DrawParams slice. Merged, the solid rect would silently sample the
    // ramp (or vice versa) instead of drawing its own color.
    expect(device.draws.length).toBe(2)
  })

  it('a gradient fill after a solid fill also breaks the batch', async () => {
    const { gfx, device } = makeGpuGfx()
    await baseFrame(gfx, device)
    gfx.fillRect(0, 0, 10, 10, '#ff0000')
    gfx.fillRect(0, 0, 100, 100, ramp())
    gfx.endFrame()
    expect(device.draws.length).toBe(2)
  })

  it('two fills with the identical gradient and transform merge into one run', async () => {
    const { gfx, device } = makeGpuGfx()
    await baseFrame(gfx, device)
    const g = ramp()
    gfx.fillRect(0, 0, 100, 100, g)
    gfx.fillRect(0, 0, 100, 100, g)
    gfx.endFrame()
    expect(device.draws.length).toBe(1)
    expect(device.draws[0].count).toBe(12)
  })

  it('two distinct gradients in sequence each get their own run', async () => {
    const { gfx, device } = makeGpuGfx()
    await baseFrame(gfx, device)
    gfx.fillRect(0, 0, 100, 100, ramp())
    gfx.fillRect(
      0,
      0,
      100,
      100,
      {
        kind: 'linear',
        x0: 0,
        y0: 0,
        x1: 100,
        y1: 0,
        stops: [
          { offset: 0, color: '#000' },
          { offset: 1, color: '#fff' },
        ],
      },
    )
    gfx.endFrame()
    expect(device.draws.length).toBe(2)
  })

  it('a gradient-filled circle and round rect draw without crashing', async () => {
    const { gfx, device } = makeGpuGfx()
    await baseFrame(gfx, device)
    gfx.fillCircle(50, 50, 20, ramp())
    gfx.fillRoundRect(0, 0, 40, 40, 8, ramp())
    gfx.endFrame()
    expect(device.draws.length).toBeGreaterThan(0)
  })

  it('many distinct gradients in one frame do not crash (atlas row recycling)', async () => {
    const { gfx, device } = makeGpuGfx()
    await baseFrame(gfx, device)
    for (let i = 0; i < 80; i++) {
      gfx.fillRect(0, 0, 10, 10, {
        kind: 'linear',
        x0: 0,
        y0: 0,
        x1: 10,
        y1: 0,
        stops: [
          { offset: 0, color: '#000' },
          { offset: 1, color: `#${i.toString(16).padStart(6, '0')}` },
        ],
      })
    }
    expect(() => gfx.endFrame()).not.toThrow()
  })
})
