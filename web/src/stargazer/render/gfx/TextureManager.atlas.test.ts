import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  ATLAS_TILE_SIZE,
  ATLAS_WIDTH,
  LABEL_PAGE_SIZE,
  PARTICLE_ATLAS_MARKER,
  TextureManager,
} from './TextureManager'
import {
  _setSharedLabelCanvasForTests,
  type LabelStyle,
} from './rasterizeLabel'
import { MockGfxDevice } from './webgl2/mockGfxDevice'

const style: LabelStyle = {
  font: '16px sans-serif',
  align: 'left',
  baseline: 'alphabetic',
  color: '#fff',
}

/**
 * Install a stub shared canvas so the real `rasterizeLabel` runs.
 *
 * Driving the real one matters here: the assertions are about agreement between
 * the bitmap it produces and the slot the packer reserves, and a hand-written
 * mock of its return value would only be asserting itself.
 */
function installRasterStub(): void {
  const canvas = { width: 1, height: 1 }
  const ctx = {
    font: '',
    textAlign: 'left' as CanvasTextAlign,
    textBaseline: 'alphabetic' as CanvasTextBaseline,
    fillStyle: '',
    measureText: () =>
      ({
        width: 20,
        actualBoundingBoxLeft: 0,
        actualBoundingBoxRight: 20,
        actualBoundingBoxAscent: 12,
        actualBoundingBoxDescent: 4,
      }) as TextMetrics,
    setTransform: () => {},
    fillText: () => {},
  }
  _setSharedLabelCanvasForTests(
    canvas as unknown as OffscreenCanvas,
    ctx as unknown as OffscreenCanvasRenderingContext2D,
  )
}

// happy-dom's OffscreenCanvas has no real 2D context, and the atlas bails out
// entirely without one. Stub a minimal context so the tile-packing path under
// test is reachable, the same way `TextureManager.mipmap.test.ts` does.
let getCtxSpy: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  getCtxSpy = vi
    .spyOn(OffscreenCanvas.prototype, 'getContext')
    .mockReturnValue({
      clearRect: () => {},
      drawImage: () => {},
      fillRect: () => {},
      fillStyle: '',
    } as never)
})
afterEach(() => getCtxSpy.mockRestore())

/** A sprite the atlas will accept. `getOrCreateEntry` reads width/height only. */
function sprite(): HTMLCanvasElement {
  const c = { width: 64, height: 64 } as HTMLCanvasElement
  ;(c as unknown as Record<string, boolean>)[PARTICLE_ATLAS_MARKER] = true
  return c
}

/** Uploads aimed at the shared atlas page, in order. */
function tileUploads(device: MockGfxDevice) {
  const page = device.textures.find((t) => t.width === ATLAS_WIDTH)
  return device.subImageUploads.filter((u) => u.tex === page)
}

describe('particle atlas tile uploads', () => {
  it('writes a tile-sized region, not a page-sized one', () => {
    // Both backends derive the written region from the SOURCE extent. A
    // page-sized source at a tile's offset asks for a write that runs off the
    // right edge for every tile but the first, which fails silently on WebGL2
    // and as an async validation error on WebGPU.
    const device = new MockGfxDevice()
    const tm = new TextureManager(device)
    for (let i = 0; i < 4; i++) tm.getOrCreateEntry(sprite())

    const uploads = tileUploads(device)
    expect(uploads.length).toBe(4)
    for (const upload of uploads) {
      expect(upload.size).toEqual({ w: ATLAS_TILE_SIZE, h: ATLAS_TILE_SIZE })
    }
  })

  it('keeps every tile inside the page', () => {
    // The invariant the old code broke: offset plus source extent has to fit.
    const device = new MockGfxDevice()
    const tm = new TextureManager(device)
    for (let i = 0; i < 40; i++) tm.getOrCreateEntry(sprite())

    for (const upload of tileUploads(device)) {
      const size = upload.size
      expect(size).not.toBeNull()
      expect(upload.x + size!.w).toBeLessThanOrEqual(ATLAS_WIDTH)
      expect(upload.y + size!.h).toBeLessThanOrEqual(ATLAS_WIDTH)
    }
  })

  it('advances the offset by a whole tile per sprite', () => {
    const device = new MockGfxDevice()
    const tm = new TextureManager(device)
    for (let i = 0; i < 3; i++) tm.getOrCreateEntry(sprite())

    const uploads = tileUploads(device)
    expect(uploads[1]!.x - uploads[0]!.x).toBe(ATLAS_TILE_SIZE)
    expect(uploads[2]!.x - uploads[1]!.x).toBe(ATLAS_TILE_SIZE)
  })

  it('reuses one tile source rather than allocating per sprite', () => {
    // The scratch canvas is reset by assigning `width`, so a smaller sprite
    // cannot inherit the previous tile's pixels without a new allocation.
    const device = new MockGfxDevice()
    const tm = new TextureManager(device)
    for (let i = 0; i < 6; i++) tm.getOrCreateEntry(sprite())

    const pages = device.textures.filter((t) => t.width === ATLAS_WIDTH)
    expect(pages.length).toBe(1)
  })
})

/**
 * The label page's slot uploads.
 *
 * These use the same `OffscreenCanvas` context stub as above, because the label
 * page and its scratch surface both need one. Without the stub the page is
 * never created and none of this is reachable.
 */
describe('label slot uploads', () => {
  beforeEach(installRasterStub)
  afterEach(() => _setSharedLabelCanvasForTests(null, null))

  function labelUploads(device: MockGfxDevice) {
    const page = device.textures.find((t) => t.width === LABEL_PAGE_SIZE)
    return device.subImageUploads.filter((u) => u.tex === page)
  }

  it('writes the whole reserved slot, gutter included', () => {
    // The stride between two same-height slots is the reserved width. The
    // uploaded source has to match it, or the gutter column keeps whatever the
    // slot's previous occupant left there and the next label's edge samples it.
    const device = new MockGfxDevice()
    const tm = new TextureManager(device)
    tm.ensureLabelTexture('a', 'aa', style, 2)
    tm.ensureLabelTexture('b', 'aa', style, 2)

    const uploads = labelUploads(device)
    expect(uploads.length).toBe(2)
    const stride = uploads[1]!.x - uploads[0]!.x
    expect(stride).toBeGreaterThan(0)
    expect(uploads[0]!.size?.w).toBe(stride)
  })

  it('reserves and writes the same height', () => {
    const device = new MockGfxDevice()
    const tm = new TextureManager(device)
    tm.ensureLabelTexture('a', 'aa', style, 2)
    tm.ensureLabelTexture('b', 'aa', style, 2)
    tm.ensureLabelTexture('c', 'aa', style, 2)

    const uploads = labelUploads(device)
    const heights = new Set(uploads.map((u) => u.size?.h))
    expect(heights.size).toBe(1)
    // A gutter row on top of the bitmap, so the row below the slot is clean.
    expect([...heights][0]).toBeGreaterThan(0)
  })

  it('keeps every slot inside the page', () => {
    const device = new MockGfxDevice()
    const tm = new TextureManager(device)
    for (let i = 0; i < 30; i++) {
      tm.ensureLabelTexture(`k${i}`, `label ${i}`, style, 2)
    }
    for (const upload of labelUploads(device)) {
      const size = upload.size
      expect(size).not.toBeNull()
      expect(upload.x + size!.w).toBeLessThanOrEqual(LABEL_PAGE_SIZE)
      expect(upload.y + size!.h).toBeLessThanOrEqual(LABEL_PAGE_SIZE)
    }
  })
})

describe('clearing the label page', () => {
  beforeEach(installRasterStub)
  afterEach(() => _setSharedLabelCanvasForTests(null, null))

  it('zeroes the rows the page had inked, on the device', () => {
    // Clearing only the CPU mirror leaves the sampled texture holding every
    // previous label, which is what bled into the next occupant of each slot.
    const device = new MockGfxDevice()
    const tm = new TextureManager(device)
    for (let i = 0; i < 6; i++) {
      tm.ensureLabelTexture(`k${i}`, `label ${i}`, style, 2)
    }
    const page = device.textures.find((t) => t.width === LABEL_PAGE_SIZE)
    const before = device.subImageUploads.length

    tm.clearLabelCache()

    const added = device.subImageUploads.slice(before)
    expect(added.length).toBe(1)
    expect(added[0]!.tex).toBe(page)
    expect(added[0]!.x).toBe(0)
    expect(added[0]!.y).toBe(0)
    expect(added[0]!.size?.w).toBe(LABEL_PAGE_SIZE)
    // Bounded by what was actually used, not the whole 2048-row page.
    expect(added[0]!.size?.h).toBeGreaterThan(0)
    expect(added[0]!.size?.h).toBeLessThan(LABEL_PAGE_SIZE)
  })

  it('writes nothing when the page never held a label', () => {
    const device = new MockGfxDevice()
    const tm = new TextureManager(device)
    const before = device.subImageUploads.length
    tm.clearLabelCache()
    expect(device.subImageUploads.length).toBe(before)
  })

  it('is safe when the page holds only oversized labels', () => {
    // Oversized labels get their own texture and never touch the page, so there
    // are no inked rows to zero.
    const device = new MockGfxDevice()
    const tm = new TextureManager(device)
    tm.ensureLabelTexture('big', 'wide', style, 200)
    const before = device.subImageUploads.length
    expect(() => tm.clearLabelCache()).not.toThrow()
    expect(device.subImageUploads.length).toBe(before)
  })
})
