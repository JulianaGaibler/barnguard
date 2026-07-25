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

function beginFrame(gfx: GpuGfx, device: MockGfxDevice): void {
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
  it('collapses circle + round-rect + text + stroke into ONE batch', () => {
    const { gfx, device } = makeGpuGfx()
    beginFrame(gfx, device)
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

  it('routes consecutive shape shapes into one growing batch', () => {
    const { gfx, device } = makeGpuGfx()
    beginFrame(gfx, device)
    for (let i = 0; i < 50; i++) gfx.fillCircle(i * 4, 10, 3, '#fff')
    for (let i = 0; i < 50; i++) gfx.fillRoundRect(i * 4, 30, 3, 3, 1, '#0f0')
    gfx.endFrame()
    expect(device.draws.length).toBe(1)
    expect(device.draws[0].instanceCount).toBe(100)
  })
})
