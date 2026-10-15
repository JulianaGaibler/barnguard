import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { GpuGfx } from './GpuGfx'
import { MockGfxDevice } from './webgl2/mockGfxDevice'
import { registerPathTessellation } from './PathTessellationRegistry'
import type { GfxFill, GfxLinearGradient } from './Gfx2D'
import { tessellateContours } from '../../assets/SvgPathContours'

// happy-dom's OffscreenCanvas has no real 2D context. Stub a minimal one so
// the ramp builder reaches the texture-cache logic under test (same stub as
// TextureManager.gradientAtlas.test.ts).
let getCtxSpy: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  getCtxSpy = vi
    .spyOn(OffscreenCanvas.prototype, 'getContext')
    .mockReturnValue({
      createLinearGradient: () => ({ addColorStop: () => {} }),
      fillStyle: '',
      clearRect: () => {},
      fillRect: () => {},
    } as never)
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
    gfx.fillRect(0, 0, 100, 100, {
      kind: 'linear',
      x0: 0,
      y0: 0,
      x1: 100,
      y1: 0,
      stops: [
        { offset: 0, color: '#000' },
        { offset: 1, color: '#fff' },
      ],
    })
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

  it('a gradient-filled retained path draws indexed, through the retained pipeline', async () => {
    const { gfx, device } = makeGpuGfx()
    await baseFrame(gfx, device)
    const path = new Path2D('M0 0 L100 0 L100 100 L0 100 Z')
    registerPathTessellation(
      path,
      {
        vertices: new Float32Array([0, 0, 100, 0, 100, 100, 0, 100]),
        indices: new Uint16Array([0, 1, 2, 0, 2, 3]),
      },
      undefined,
      undefined,
      { retained: true },
    )
    gfx.fillPath2D(path, ramp())
    gfx.endFrame()
    expect(device.draws.length).toBe(1)
    // Indexed draw is only reachable through `#drawRetained`, never the
    // streamed `coloredTri` path.
    expect(device.draws[0].kind).toBe('elements')
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

describe('GpuGfx retained fills', () => {
  function hexPath(r: number, cx: number): Path2D {
    const n = 48
    const contour = new Float32Array(n * 2)
    for (let i = 0; i < n; i++) {
      const a = (Math.PI * 2 * i) / n
      contour[i * 2] = cx + Math.cos(a) * r
      contour[i * 2 + 1] = 100 + Math.sin(a) * r
    }
    const path = new Path2D()
    registerPathTessellation(path, tessellateContours([contour]), [contour])
    return path
  }

  const gradient = {
    kind: 'linear' as const,
    x0: 0,
    y0: 0,
    x1: 0,
    y1: 100,
    stops: [
      { offset: 0, color: '#ff0000' },
      { offset: 1, color: '#0000ff' },
    ],
  }

  async function frame(
    gfx: GpuGfx,
    device: MockGfxDevice,
    paths: Path2D[],
    fill: (i: number) => GfxFill,
  ): Promise<{ draws: number; uploaded: number }> {
    await baseFrame(gfx, device)
    paths.forEach((p, i) => gfx.fillPath2D(p, fill(i)))
    gfx.endFrame()
    return { draws: device.draws.length, uploaded: gfx.stats.bytesUploaded }
  }

  async function threeFrames(
    paths: Path2D[],
    fill: (i: number) => GfxFill,
  ): Promise<{ draws: number; uploaded: number }[]> {
    const { gfx, device } = makeGpuGfx()
    const out = []
    for (let k = 0; k < 3; k++) out.push(await frame(gfx, device, paths, fill))
    return out
  }

  const own = (i: number): GfxFill => ({ ...gradient, y1: 100 + i * 50 })

  it('keeps a gradient fill that repeats, with the same draw count', async () => {
    const [first, , third] = await threeFrames(
      [hexPath(40, 60), hexPath(40, 200)],
      own,
    )
    expect(first.uploaded).toBeGreaterThan(0)
    expect(third.uploaded).toBe(0)
    expect(third.draws).toBe(first.draws)
  })

  it('streams fills that share a gradient, so they still draw as one', async () => {
    const [first, , third] = await threeFrames(
      [hexPath(40, 60), hexPath(40, 200)],
      () => gradient,
    )
    expect(first.draws).toBe(1)
    expect(third.draws).toBe(1)
    expect(third.uploaded).toBeGreaterThan(0)
  })

  it('leaves small flat fills streamed so they still merge', async () => {
    const [first, , third] = await threeFrames(
      [hexPath(40, 60), hexPath(40, 200)],
      () => '#ffffff',
    )
    expect(first.draws).toBe(1)
    expect(third.draws).toBe(1)
    expect(third.uploaded).toBeGreaterThan(0)
  })

  it('lets streamed runs merge across a kept fill they do not touch', async () => {
    const { gfx, device } = makeGpuGfx()
    const path = hexPath(40, 200)
    const draw = async (): Promise<number> => {
      await baseFrame(gfx, device)
      gfx.fillRect(0, 0, 10, 10, '#ff0000')
      gfx.fillPath2D(path, gradient)
      gfx.fillRect(390, 290, 10, 10, '#ff0000')
      gfx.endFrame()
      return device.draws.length
    }
    await draw()
    await draw()
    expect(await draw()).toBe(2)
  })

  it('frees kept geometry once it goes undrawn', async () => {
    const { gfx, device } = makeGpuGfx()
    const path = hexPath(40, 200)
    await frame(gfx, device, [path], () => gradient)
    await frame(gfx, device, [path], () => gradient)
    expect(gfx.cacheStats()[1].entries).toBe(1)
    for (let i = 0; i < 125; i++) {
      await baseFrame(gfx, device)
      gfx.endFrame()
    }
    expect(gfx.cacheStats()[1].entries).toBe(0)
    expect(device.deletedBuffers.length).toBeGreaterThan(0)
  })
})
