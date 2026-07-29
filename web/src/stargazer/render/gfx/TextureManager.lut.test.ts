import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { TextureManager } from './TextureManager'
import { MockGfxDevice } from './webgl2/mockGfxDevice'
import type { GfxGradientStop } from './Gfx2D'

// happy-dom's OffscreenCanvas has no real 2D context; stub a minimal one so the
// LUT builder reaches the texture-cache logic under test.
let getCtxSpy: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  const fake = {
    createLinearGradient: () => ({ addColorStop: () => {} }),
    fillStyle: '',
    fillRect: () => {},
  }
  getCtxSpy = vi
    .spyOn(OffscreenCanvas.prototype, 'getContext')
    .mockReturnValue(fake as never)
})
afterEach(() => {
  getCtxSpy.mockRestore()
})

const stops = (a: string, b: string): GfxGradientStop[] => [
  { offset: 0, color: a },
  { offset: 1, color: b },
]

describe('TextureManager gradient-LUT cache', () => {
  it('dedups by content across distinct array references', () => {
    const device = new MockGfxDevice()
    const tm = new TextureManager(device)
    const t1 = tm.ensureStopsLut(stops('#000', '#fff'))
    const t2 = tm.ensureStopsLut(stops('#000', '#fff')) // new array, same content
    expect(t1).not.toBeNull()
    expect(t2).toBe(t1)
    // One texture, not the per-frame leak a fresh array used to cause.
    expect(device.textures.length).toBe(1)
  })

  it('builds one texture per distinct content', () => {
    const device = new MockGfxDevice()
    const tm = new TextureManager(device)
    tm.ensureStopsLut(stops('#000', '#fff'))
    tm.ensureStopsLut(stops('#000', '#f00'))
    expect(device.textures.length).toBe(2)
  })

  it('evicts and deletes the least-recently-used LUT beyond the cap', () => {
    const device = new MockGfxDevice()
    const del = vi.spyOn(device, 'deleteTexture')
    const tm = new TextureManager(device)
    // Cap is 64; 65 distinct LUTs → exactly one eviction + delete.
    for (let i = 0; i < 65; i++) {
      tm.ensureStopsLut(stops('#000', `#${i.toString(16).padStart(6, '0')}`))
    }
    expect(del).toHaveBeenCalledTimes(1)
  })

  it('re-touches a reused LUT so it survives eviction pressure', () => {
    const device = new MockGfxDevice()
    const del = vi.spyOn(device, 'deleteTexture')
    const tm = new TextureManager(device)
    const keep = stops('#000', '#keep0')
    const first = tm.ensureStopsLut(keep)
    // Fill to the cap with distinct LUTs, touching `keep` each round so it stays
    // most-recent and is never the eviction victim.
    for (let i = 0; i < 70; i++) {
      tm.ensureStopsLut(stops('#000', `#${i.toString(16).padStart(6, '0')}`))
      tm.ensureStopsLut(keep)
    }
    // `keep` is still the same texture (never evicted/rebuilt). Compare by
    // identity — all LUT textures are structurally identical (256×1), so a
    // deep-equality matcher would false-match any evicted LUT.
    expect(tm.ensureStopsLut(keep)).toBe(first)
    const deletedFirst = del.mock.calls.some((c) => c[0] === first)
    expect(deletedFirst).toBe(false)
  })
})
