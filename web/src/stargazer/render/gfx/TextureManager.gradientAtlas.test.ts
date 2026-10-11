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

const noSubmit = (): void => {}

describe('TextureManager gradient ramp atlas', () => {
  it('dedups by content across distinct array references', () => {
    const device = new MockGfxDevice()
    const tm = new TextureManager(device)
    const r1 = tm.ensureStopsRow(stops('#000', '#fff'), noSubmit)
    const r2 = tm.ensureStopsRow(stops('#000', '#fff'), noSubmit) // new array, same content
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
    const r1 = tm.ensureStopsRow(stops('#000', '#fff'), noSubmit)
    const r2 = tm.ensureStopsRow(stops('#000', '#f00'), noSubmit)
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
        tm.ensureStopsRow(
          stops('#000', `#${i.toString(16).padStart(6, '0')}`),
          noSubmit,
        ),
      )
    }
    // Every row is pinned (all allocated this "frame"), so a 65th distinct
    // ramp has nothing to recycle without a forced submit.
    const forceSubmit = vi.fn()
    tm.ensureStopsRow(stops('#000', '#overflow'), forceSubmit)
    expect(forceSubmit).toHaveBeenCalledTimes(1)
  })

  it('recycles freely once pins are flushed, reusing the oldest row', () => {
    const device = new MockGfxDevice()
    const tm = new TextureManager(device)
    const first = tm.ensureStopsRow(stops('#000', '#first'), noSubmit)
    for (let i = 1; i < ATLAS_ROWS; i++) {
      tm.ensureStopsRow(
        stops('#000', `#${i.toString(16).padStart(6, '0')}`),
        noSubmit,
      )
    }
    tm.flushRampRowPins()
    // The 65th distinct ramp recycles the least-recently-touched row, which
    // is `first`'s (never touched again above), with no forced submit needed.
    const forceSubmit = vi.fn()
    const recycled = tm.ensureStopsRow(stops('#000', '#overflow'), forceSubmit)
    expect(forceSubmit).not.toHaveBeenCalled()
    expect(recycled).toBe(first)
    // Re-requesting the original content now misses (its row was recycled)
    // and gets a different row than before.
    expect(tm.ensureStopsRow(stops('#000', '#first'), noSubmit)).not.toBe(
      first,
    )
  })

  it('re-touches a reused row so it survives eviction pressure', () => {
    const device = new MockGfxDevice()
    const tm = new TextureManager(device)
    const keep = stops('#000', '#keep0')
    const first = tm.ensureStopsRow(keep, noSubmit)
    // Fill past the cap with distinct ramps, touching `keep` each round (and
    // flushing pins between rounds) so it stays most-recent and is never the
    // eviction victim.
    for (let i = 0; i < ATLAS_ROWS + 10; i++) {
      tm.flushRampRowPins()
      tm.ensureStopsRow(
        stops('#000', `#${i.toString(16).padStart(6, '0')}`),
        noSubmit,
      )
      tm.ensureStopsRow(keep, noSubmit)
    }
    expect(tm.ensureStopsRow(keep, noSubmit)).toBe(first)
    void device
  })
})
