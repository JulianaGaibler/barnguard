import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { PARTICLE_ATLAS_MARKER, TextureManager } from './TextureManager'
import { MockGfxDevice } from './webgl2/mockGfxDevice'
import type { GfxGradientStop } from './Gfx2D'

// happy-dom's OffscreenCanvas has no real 2D context. Stub a minimal one so
// the LUT builder reaches the texture allocation under test.
let getCtxSpy: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  getCtxSpy = vi
    .spyOn(OffscreenCanvas.prototype, 'getContext')
    .mockReturnValue({
      createLinearGradient: () => ({ addColorStop: () => {} }),
      fillStyle: '',
      fillRect: () => {},
      clearRect: () => {},
      drawImage: () => {},
    } as never)
})
afterEach(() => getCtxSpy.mockRestore())

const stops: GfxGradientStop[] = [
  { offset: 0, color: '#000' },
  { offset: 1, color: '#fff' },
]

/** A canvas-shaped source. `getOrCreateEntry` only reads `width`/`height`. */
const source = (width: number, height: number): HTMLCanvasElement =>
  ({ width, height }) as HTMLCanvasElement

const particleSprite = (): HTMLCanvasElement => {
  const c = source(64, 64)
  ;(c as unknown as Record<string, boolean>)[PARTICLE_ATLAS_MARKER] = true
  return c
}

/** Options recorded for the texture allocated at `index`. */
const optsFor = (device: MockGfxDevice, index: number) =>
  device.textureOpts[index]!

describe('TextureManager drawImage texture sampling', () => {
  it('gives a per-source texture a mip chain', () => {
    const device = new MockGfxDevice()
    const tm = new TextureManager(device)
    tm.getOrCreateEntry(source(160, 160))
    expect(device.textureOpts).toHaveLength(1)
    expect(optsFor(device, 0).mipmap).toBe(true)
    expect(optsFor(device, 0).filter).toBe('linear')
  })

  it('does not ask for anisotropy, which does nothing for screen-aligned 2D', () => {
    const device = new MockGfxDevice()
    const tm = new TextureManager(device)
    tm.getOrCreateEntry(source(160, 160))
    expect(optsFor(device, 0).anisotropy).toBeUndefined()
  })

  it('leaves a gradient LUT unmipped, since it is never minified', () => {
    const device = new MockGfxDevice()
    const tm = new TextureManager(device)
    expect(tm.ensureStopsLut(stops)).not.toBeNull()
    expect(device.textureOpts).toHaveLength(1)
    expect(optsFor(device, 0).mipmap).toBeFalsy()
  })

  it('leaves the shared particle atlas page unmipped', () => {
    // One texel of tile padding only isolates level 0, so a chain here would
    // average neighbouring sprites into each other from the first level down.
    const device = new MockGfxDevice()
    const tm = new TextureManager(device)
    tm.getOrCreateEntry(particleSprite())
    const page = device.textureOpts.filter((o) => o.width === 1024)
    expect(page.length).toBeGreaterThan(0)
    for (const opts of page) expect(opts.mipmap).toBeFalsy()
  })

  it('reuses one texture per source rather than reallocating', () => {
    const device = new MockGfxDevice()
    const tm = new TextureManager(device)
    const src = source(68, 80)
    const a = tm.getOrCreateEntry(src)
    const b = tm.getOrCreateEntry(src)
    expect(b).toBe(a)
    expect(device.textureOpts).toHaveLength(1)
  })

  it('skips a zero-sized source instead of allocating', () => {
    const device = new MockGfxDevice()
    const tm = new TextureManager(device)
    expect(tm.getOrCreateEntry(source(0, 40))).toBeNull()
    expect(device.textureOpts).toHaveLength(0)
  })
})
