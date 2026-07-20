import { describe, it, expect, vi } from 'vitest'

// Mock the rasterizer so fillText runs without a real 2D canvas context. The
// stub reports a fixed local size + anchor; texW/texH scale with the request.
vi.mock('../rasterizeLabel', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../rasterizeLabel')>()
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
}

describe('GpuGfx.fillText', () => {
  it('emits one text-quad instance with the expected rotated affine and white tint', () => {
    const { gfx, device } = makeGpuGfx()
    beginFrame(gfx, device)
    // 90° rotation: a=0,b=1,c=-1,d=0, translate (100,50). deviceScale = 1.
    gfx.setBaseTransform(0, 1, -1, 0, 100, 50)
    gfx.setAlpha(1)
    gfx.fillText('hi', 0, 0, { font: '10px x', color: '#f00' })
    gfx.endFrame()

    expect(device.draws.length).toBe(1)
    const d = device.draws[0]
    expect(d.kind).toBe('instanced')
    expect(d.count).toBe(6)
    expect(d.instanceCount).toBe(1)

    const fv = new Float32Array(d.bufferSnapshot as ArrayBuffer)
    // localW=10, localH=4, anchor (1,3). dx=-1, dy=-3.
    // col0 = (a*w, b*w) = (0, 10); col1 = (c*h, d*h) = (-4, 0)
    // translate = (a*dx + c*dy + e, b*dx + d*dy + f) = (103, 49)
    expect(fv[0]).toBeCloseTo(0) // col0.x
    expect(fv[1]).toBeCloseTo(10) // col0.y
    expect(fv[2]).toBeCloseTo(-4) // col1.x
    expect(fv[3]).toBeCloseTo(0) // col1.y
    expect(fv[4]).toBeCloseTo(103) // translate.x
    expect(fv[5]).toBeCloseTo(49) // translate.y
    // srcRect = full texture.
    expect([fv[6], fv[7], fv[8], fv[9]]).toEqual([0, 0, 1, 1])
    const uv = new Uint32Array(d.bufferSnapshot as ArrayBuffer)
    expect(uv[10]).toBe(0xffffffff) // white × alpha(1)
  })

  it('reuses one texture across rotation changes (rotation is free)', () => {
    const { gfx, device } = makeGpuGfx()
    beginFrame(gfx, device)
    gfx.setAlpha(1)
    // Two draws, same label + net scale (=1), different rotation.
    gfx.setBaseTransform(1, 0, 0, 1, 0, 0) // 0°
    gfx.fillText('hi', 0, 0, { font: '10px x', color: '#fff' })
    gfx.setBaseTransform(0, 1, -1, 0, 0, 0) // 90°
    gfx.fillText('hi', 0, 0, { font: '10px x', color: '#fff' })
    gfx.endFrame()

    expect(device.textures.length).toBe(1) // no re-rasterization
    expect(device.draws.length).toBe(1) // both instances batch on one texture
    expect(device.draws[0].instanceCount).toBe(2)
  })

  it('re-rasterizes when the net scale crosses buckets', () => {
    const { gfx, device } = makeGpuGfx()
    beginFrame(gfx, device)
    gfx.setAlpha(1)
    gfx.setBaseTransform(1, 0, 0, 1, 0, 0) // scale 1
    gfx.fillText('hi', 0, 0, { font: '10px x', color: '#fff' })
    gfx.setBaseTransform(4, 0, 0, 4, 0, 0) // scale 4 → higher bucket
    gfx.fillText('hi', 0, 0, { font: '10px x', color: '#fff' })
    gfx.endFrame()
    expect(device.textures.length).toBe(2)
  })

  it('snaps translation to whole device pixels for axis-aligned draws', () => {
    const { gfx, device } = makeGpuGfx()
    beginFrame(gfx, device)
    gfx.setAlpha(1)
    gfx.setBaseTransform(1, 0, 0, 1, 100.4, 50.6)
    gfx.fillText('hi', 0, 0, { font: '10px x', color: '#fff' })
    gfx.endFrame()
    const fv = new Float32Array(device.draws[0].bufferSnapshot as ArrayBuffer)
    // translate.x = 1*(-1) + 100.4 = 99.4 → 99; translate.y = -3 + 50.6 = 47.6 → 48.
    expect(fv[4]).toBe(99)
    expect(fv[5]).toBe(48)
  })

  it('folds the current alpha into the tint', () => {
    const { gfx, device } = makeGpuGfx()
    beginFrame(gfx, device)
    gfx.setBaseTransform(1, 0, 0, 1, 0, 0)
    gfx.setAlpha(0.5)
    gfx.fillText('hi', 0, 0, { font: '10px x', color: '#fff' })
    gfx.endFrame()
    const uv = new Uint32Array(device.draws[0].bufferSnapshot as ArrayBuffer)
    // 0.5 × 255 = 127.5 → 128 in every channel.
    expect(uv[10]).toBe(0x80808080)
  })

  it('draws nothing for an empty string', () => {
    const { gfx, device } = makeGpuGfx()
    beginFrame(gfx, device)
    gfx.setBaseTransform(1, 0, 0, 1, 0, 0)
    gfx.fillText('', 0, 0, { font: '10px x' })
    gfx.endFrame()
    expect(device.draws.length).toBe(0)
    expect(device.textures.length).toBe(0)
  })
})
