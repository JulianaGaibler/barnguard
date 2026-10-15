import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ATLAS_ROWS, TextureManager } from './TextureManager'
import { MockGfxDevice } from './webgl2/mockGfxDevice'
import type { GfxGradientStop } from './Gfx2D'

// happy-dom's OffscreenCanvas has no real 2D context. Stub a minimal one so
// the ramp builder reaches the texture-cache logic under test.
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

describe('TextureManager gradient ramp atlas', () => {
  it('dedups by content across distinct array references', () => {
    const device = new MockGfxDevice()
    const tm = new TextureManager(device)
    const r1 = tm.ensureStopsRow(stops('#000', '#fff'))
    const r2 = tm.ensureStopsRow(stops('#000', '#fff')) // new array, same content
    expect(r1).toBeGreaterThanOrEqual(0)
    expect(r2).toBe(r1)
    // One atlas texture, one row painted, not the per-frame leak a fresh
    // array used to cause against the old per-ramp-texture cache.
    expect(device.textures.length).toBe(1)
    expect(device.subImageUploads.length).toBe(1)
  })

  it('gives each distinct content its own row in one shared texture', () => {
    const device = new MockGfxDevice()
    const tm = new TextureManager(device)
    const r1 = tm.ensureStopsRow(stops('#000', '#fff'))
    const r2 = tm.ensureStopsRow(stops('#000', '#f00'))
    expect(r2).not.toBe(r1)
    // Still one texture: a draw sampling a different row never binds a
    // different texture, so it never breaks the batch.
    expect(device.textures.length).toBe(1)
    expect(device.subImageUploads.length).toBe(2)
  })

  it('recycles the least-recently-touched row beyond the cap, pinned until flushed', () => {
    const device = new MockGfxDevice()
    const tm = new TextureManager(device)
    const rows: number[] = []
    for (let i = 0; i < ATLAS_ROWS; i++) {
      rows.push(
        tm.ensureStopsRow(stops('#000', `#${i.toString(16).padStart(6, '0')}`)),
      )
    }
    // Every row is pinned (all allocated this "frame"), so a 65th distinct
    // ramp has nothing to recycle and reports failure.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(tm.ensureStopsRow(stops('#000', '#overflow'))).toBe(-1)
    expect(warn).toHaveBeenCalledTimes(1)
    warn.mockRestore()
  })

  it('recycles freely once pins are flushed, reusing the oldest row', () => {
    const device = new MockGfxDevice()
    const tm = new TextureManager(device)
    const first = tm.ensureStopsRow(stops('#000', '#first'))
    for (let i = 1; i < ATLAS_ROWS; i++) {
      tm.ensureStopsRow(stops('#000', `#${i.toString(16).padStart(6, '0')}`))
    }
    tm.flushRampRowPins()
    // The 65th distinct ramp recycles the least-recently-touched row, which
    // is `first`'s (never touched again above).
    const recycled = tm.ensureStopsRow(stops('#000', '#overflow'))
    expect(recycled).toBe(first)
    // Re-requesting the original content now misses (its row was recycled)
    // and gets a different row than before.
    expect(tm.ensureStopsRow(stops('#000', '#first'))).not.toBe(first)
  })

  it('re-touches a reused row so it survives eviction pressure', () => {
    const device = new MockGfxDevice()
    const tm = new TextureManager(device)
    const keep = stops('#000', '#keep0')
    const first = tm.ensureStopsRow(keep)
    // Fill past the cap with distinct ramps, touching `keep` each round (and
    // flushing pins between rounds) so it stays most-recent and is never the
    // eviction victim.
    for (let i = 0; i < ATLAS_ROWS + 10; i++) {
      tm.flushRampRowPins()
      tm.ensureStopsRow(stops('#000', `#${i.toString(16).padStart(6, '0')}`))
      tm.ensureStopsRow(keep)
    }
    expect(tm.ensureStopsRow(keep)).toBe(first)
    void device
  })
})
