import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the rasterizer so the cache logic is exercised without a real canvas.
// texW/texH track the scale so bucket behavior is observable.
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

import { TextureManager } from './TextureManager'
import { MockGfxDevice } from './webgl2/mockGfxDevice'
import type { LabelStyle } from '../rasterizeLabel'

const style: LabelStyle = {
  font: '10px x',
  align: 'left',
  baseline: 'alphabetic',
  color: '#000',
}

let device: MockGfxDevice
let tm: TextureManager

beforeEach(() => {
  device = new MockGfxDevice()
  tm = new TextureManager(device)
})

describe('TextureManager label cache', () => {
  it('rasterizes once per key and reuses on repeat', () => {
    const a = tm.ensureLabelTexture('base', 'hi', style, 2)
    const b = tm.ensureLabelTexture('base', 'hi', style, 2)
    expect(a).not.toBeNull()
    expect(b).toBe(a)
    expect(device.textures.length).toBe(1)
  })

  it('reuses within a scale bucket (hysteresis) but rebuilds across buckets', () => {
    // 1.7 and 1.99 share a bucket; 2.0 is the next bucket up.
    tm.ensureLabelTexture('base', 'hi', style, 1.7)
    tm.ensureLabelTexture('base', 'hi', style, 1.99)
    expect(device.textures.length).toBe(1)
    tm.ensureLabelTexture('base', 'hi', style, 4)
    expect(device.textures.length).toBe(2)
  })

  it('drops the cache on rebuild (context loss) without deleting dead textures', () => {
    const del = vi.spyOn(device, 'deleteTexture')
    tm.ensureLabelTexture('base', 'hi', style, 2)
    tm.rebuild(device)
    expect(del).not.toHaveBeenCalled() // GL textures already gone
    tm.ensureLabelTexture('base', 'hi', style, 2)
    expect(device.textures.length).toBe(2) // regenerated fresh
  })

  it('evicts the least-recently-used label and deletes its GL texture', () => {
    const del = vi.spyOn(device, 'deleteTexture')
    // 257 distinct labels (cap is 256) → exactly one eviction.
    for (let i = 0; i < 257; i++) {
      tm.ensureLabelTexture(`label-${i}`, `t${i}`, style, 2)
    }
    expect(device.textures.length).toBe(257)
    expect(del).toHaveBeenCalledTimes(1)
  })

  it('rides a neighbouring bucket when the per-frame regen budget is exhausted', () => {
    tm.resetLabelBudget()
    const e0 = tm.ensureLabelTexture('key0', 't', style, 2) // bucket k, regen #1
    for (let i = 1; i <= 7; i++) {
      tm.ensureLabelTexture(`key${i}`, 't', style, 2) // regens #2..#8 (budget = 8)
    }
    const before = device.textures.length
    // Same label at a neighbouring bucket while over budget → ride, no upload.
    const near = tm.ensureLabelTexture('key0', 't', style, 2.3)
    expect(near).toBe(e0)
    expect(device.textures.length).toBe(before)
  })
})
