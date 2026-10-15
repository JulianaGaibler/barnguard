import { describe, it, expect, vi } from 'vitest'

// Mock the rasterizer so fillText runs without a real 2D canvas context (the
// label then packs into the shared page, which the shape binds at its fixed
// label unit). Mirrors GpuGfx.text.test.ts.
vi.mock('./rasterizeLabel', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./rasterizeLabel')>()
  return {
    ...actual,
    rasterizeLabel: (_text: string, _style: unknown, scale: number) => ({
      canvas: {} as HTMLCanvasElement,
      texW: Math.max(1, Math.round(10 * scale)),
      texH: Math.max(1, Math.round(4 * scale)),
      localW: 10,
      localH: 4,
      anchorOffsetX: 1,
      anchorOffsetY: 3,
    }),
  }
})

import { GpuGfx } from './GpuGfx'
import { MockGfxDevice } from './webgl2/mockGfxDevice'

function makeGpuGfx(): { gfx: GpuGfx; device: MockGfxDevice } {
  const canvas = document.createElement('canvas')
  canvas.width = 400
  canvas.height = 300
  const device = new MockGfxDevice()
  const gfx = new GpuGfx(canvas, device)
  return { gfx, device }
}

async function beginFrame(gfx: GpuGfx, device: MockGfxDevice): Promise<void> {
  await gfx.whenReady // pipelines warm asynchronously
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

describe('GpuGfx shape program', () => {
  it('collapses circle + round-rect + text + stroke into ONE batch', async () => {
    const { gfx, device } = makeGpuGfx()
    await beginFrame(gfx, device)
    gfx.fillCircle(20, 20, 8, '#ff8040') // shape (circle)
    gfx.fillRoundRect(40, 10, 30, 16, 4, '#8f74e7') // shape (round-rect)
    gfx.fillText('hi', 80, 20, { font: '10px x', color: '#fff' }) // shape (label page)
    gfx.strokeCircle(120, 20, 10, { color: '#41a8ff', width: 2 }) // shape (circle)
    gfx.endFrame()
    // All four shape families share one blend-only shape batch.
    expect(device.draws.length).toBe(1)
    expect(device.draws[0].kind).toBe('instancedRange')
    expect(device.draws[0].instanceCount).toBe(4)
  })

  it('routes consecutive shape shapes into one growing batch', async () => {
    const { gfx, device } = makeGpuGfx()
    await beginFrame(gfx, device)
    for (let i = 0; i < 50; i++) gfx.fillCircle(i * 4, 10, 3, '#fff')
    for (let i = 0; i < 50; i++) gfx.fillRoundRect(i * 4, 30, 3, 3, 1, '#0f0')
    gfx.endFrame()
    expect(device.draws.length).toBe(1)
    expect(device.draws[0].instanceCount).toBe(100)
  })

  describe('debug render modes', () => {
    it("'overdraw' forces the shape draw onto the additive pipeline", async () => {
      const { gfx, device } = makeGpuGfx()
      await beginFrame(gfx, device)
      gfx.setDebugRenderMode('overdraw')
      gfx.fillCircle(20, 20, 8, '#ff8040')
      gfx.fillRoundRect(40, 10, 30, 16, 4, '#8f74e7')
      gfx.endFrame()
      expect(device.draws.length).toBe(1)
      expect(device.draws[0].blend).toBe('lighter')
    })

    it("'batch-color' still draws the normal (non-additive) pipeline", async () => {
      const { gfx, device } = makeGpuGfx()
      await beginFrame(gfx, device)
      gfx.setDebugRenderMode('batch-color')
      gfx.fillCircle(20, 20, 8, '#ff8040')
      gfx.endFrame()
      expect(device.draws.length).toBe(1)
      expect(device.draws[0].blend).toBe('source-over')
    })

    it("returning to 'normal' restores the ordinary pipeline", async () => {
      const { gfx, device } = makeGpuGfx()
      await beginFrame(gfx, device)
      gfx.setDebugRenderMode('overdraw')
      gfx.fillCircle(0, 0, 4, '#fff')
      gfx.setDebugRenderMode('normal')
      gfx.fillCircle(20, 0, 4, '#fff')
      gfx.endFrame()
      // The mode switch flushes, so the two circles land in separate runs.
      expect(device.draws.length).toBe(2)
      expect(device.draws[0].blend).toBe('lighter')
      expect(device.draws[1].blend).toBe('source-over')
    })
  })
})

describe('GpuGfx smooth corners', () => {
  // Word offset of the round-rect record's per-corner smoothing, see
  // `programs/shape.ts`. 29 words per instance.
  const SMOOTHING_WORD = 18
  const RECORD_WORDS = 29

  function smoothingOf(device: MockGfxDevice, instance = 0): number[] {
    const words = new Float32Array(
      device.draws[0].bufferSnapshot as ArrayBuffer,
    )
    const at = instance * RECORD_WORDS + SMOOTHING_WORD
    return Array.from(words.subarray(at, at + 4))
  }

  it('draws circular corners until the corner field is loaded', async () => {
    const { gfx, device } = makeGpuGfx()
    await beginFrame(gfx, device)
    gfx.fillRoundRect(0, 0, 200, 200, 40, '#fff', 0.6)
    gfx.endFrame()
    expect(smoothingOf(device)).toEqual([0, 0, 0, 0])
  })

  it('writes each corner its fitted smoothing once the field is loaded', async () => {
    vi.resetModules()
    vi.doMock('./squircleField', async (importOriginal) => ({
      ...(await importOriginal<typeof import('./squircleField')>()),
      loadField: () => Promise.resolve(new Uint16Array(64 * 64 * 21 * 4)),
    }))
    const { GpuGfx: FieldGpuGfx } = await import('./GpuGfx')
    const canvas = document.createElement('canvas')
    canvas.width = 400
    canvas.height = 300
    const device = new MockGfxDevice()
    const gfx = new FieldGpuGfx(canvas, device)
    await beginFrame(gfx, device)
    // Uniform radius 40 on 200 x 100: each corner may use 50 of a side, so
    // smoothing 0.6 is fitted down to 50 / 40 - 1 = 0.25.
    gfx.fillRoundRect(0, 0, 200, 100, 40, '#fff', 0.6)
    gfx.fillRoundRect(0, 0, 200, 200, 40, '#fff', 0.6)
    gfx.endFrame()
    for (const v of smoothingOf(device, 0)) expect(v).toBeCloseTo(0.25)
    for (const v of smoothingOf(device, 1)) expect(v).toBeCloseTo(0.6)
    expect(device.dataUploads).toHaveLength(1)
    vi.doUnmock('./squircleField')
  })
})

describe('GpuGfx ellipse', () => {
  it('draws an ellipse as one shape instance of its own kind, in the shape batch', async () => {
    const { gfx, device } = makeGpuGfx()
    await beginFrame(gfx, device)
    gfx.fillRoundRect(0, 0, 30, 16, 4, '#8f74e7')
    gfx.fillAndStrokeEllipse(100, 50, 40, 20, '#fff', {
      color: '#000',
      width: 2,
    })
    gfx.endFrame()
    expect(device.draws.length).toBe(1)
    expect(device.draws[0].instanceCount).toBe(2)
    const words = new Float32Array(
      device.draws[0].bufferSnapshot as ArrayBuffer,
    )
    // Kind word of the second instance, then its half size and stroke.
    expect(words[29 + 6]).toBe(4)
    expect(Array.from(words.subarray(29 + 10, 29 + 13))).toEqual([40, 20, 2])
  })
})
