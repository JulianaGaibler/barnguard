import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the rasterizer so the cache logic is exercised without a real canvas.
// texW/texH track the scale so bucket behavior is observable.
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

import { PARTICLE_ATLAS_MARKER, TextureManager } from './TextureManager'
import { MockGfxDevice } from './webgl2/mockGfxDevice'
import type { LabelStyle } from './rasterizeLabel'

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

  it('reuses within a scale bucket (hysteresis) but re-rasterizes across buckets', () => {
    // 1.7 and 1.99 share a bucket, 2.0+ is the next bucket up. All labels pack
    // into the one shared page, so the texture count stays 1 and a
    // re-rasterization shows up as an extra sub-image upload.
    tm.ensureLabelTexture('base', 'hi', style, 1.7)
    tm.ensureLabelTexture('base', 'hi', style, 1.99)
    expect(device.textures.length).toBe(1) // the page
    expect(device.subImageUploads.length).toBe(1) // one rasterization in-bucket
    tm.ensureLabelTexture('base', 'hi', style, 4)
    expect(device.textures.length).toBe(1) // still just the page
    expect(device.subImageUploads.length).toBe(2) // new bucket → new sub-upload
  })

  it('drops the cache on rebuild (context loss) without deleting dead textures', () => {
    const del = vi.spyOn(device, 'deleteTexture')
    tm.ensureLabelTexture('base', 'hi', style, 2)
    tm.rebuild(device)
    expect(del).not.toHaveBeenCalled() // GL textures already gone
    tm.ensureLabelTexture('base', 'hi', style, 2)
    expect(device.textures.length).toBe(2) // regenerated fresh
  })

  it('evicts the least-recently-used page label by freeing its span, not deleting the shared page', () => {
    const del = vi.spyOn(device, 'deleteTexture')
    // 769 distinct labels (cap is 768) → exactly one eviction. All are
    // page-backed, so eviction frees a span and the shared page survives.
    for (let i = 0; i < 769; i++) {
      tm.ensureLabelTexture(`label-${i}`, `t${i}`, style, 2)
    }
    expect(device.textures.length).toBe(1) // one shared page, no per-label textures
    expect(del).not.toHaveBeenCalled() // page-backed eviction frees, never deletes
  })

  it('gives an oversized label its own texture and deletes it on eviction', () => {
    const del = vi.spyOn(device, 'deleteTexture')
    // scale 60 → texW ≈ 600 > 512 threshold → dedicated texture (not the page).
    tm.ensureLabelTexture('big', 'T', style, 60)
    // Fill past the cap so the oversized label (the LRU) is evicted.
    for (let i = 0; i < 768; i++) {
      tm.ensureLabelTexture(`label-${i}`, `t${i}`, style, 2)
    }
    expect(del).toHaveBeenCalledTimes(1) // the dedicated oversized texture
  })

  it('rides a neighbouring bucket when the per-frame regen budget is exhausted', () => {
    tm.resetLabelBudget()
    const e0 = tm.ensureLabelTexture('key0', 't', style, 2) // bucket k, regen #1
    for (let i = 1; i <= 23; i++) {
      tm.ensureLabelTexture(`key${i}`, 't', style, 2) // regens #2..#24 (budget = 24)
    }
    const before = device.textures.length
    // Same label at a neighbouring bucket while over budget → ride, no upload.
    const near = tm.ensureLabelTexture('key0', 't', style, 2.3)
    expect(near).toBe(e0)
    expect(device.textures.length).toBe(before)
  })

  it('borrows the larger bucket in preference to the smaller one', () => {
    // Both neighbours cached, so the choice is free. Minifying a bigger bitmap
    // stays sharp, magnifying a smaller one cannot.
    tm.resetLabelBudget()
    // Buckets step by 2**(1/3), so a device scale of 2 sits at k = 3 and these
    // two land exactly one bucket either side of it.
    const bigger = tm.ensureLabelTexture('k', 't', style, 2.4) // k + 1
    const smaller = tm.ensureLabelTexture('k', 't', style, 1.5) // k - 1
    expect(smaller).not.toBe(bigger)
    for (let i = 0; i < 24; i++) {
      tm.ensureLabelTexture(`filler${i}`, 't', style, 2)
    }
    expect(tm.ensureLabelTexture('k', 't', style, 2)).toBe(bigger)
  })
})

describe('label atlas upload orientation', () => {
  // The glyph bitmap comes off a 2D canvas, which is top-left origin, and the
  // shaders sample it with `uv = mix(srcRect.xy, srcRect.zw, unit)`, which walks
  // V downward. So the upload must not flip: a flip puts every glyph upside
  // down inside its atlas slot, and because text is often the only asymmetric
  // texture on screen, nothing else looks wrong.
  //
  // This pins the caller. The other half of the invariant, that both backends
  // apply the requested flip rather than adjusting it, cannot be covered
  // headlessly: it lives in the real device implementations and needs a GPU.
  it('asks for no flip when packing a glyph into the shared page', () => {
    tm.ensureLabelTexture('base', 'hi', style, 1)
    expect(device.subImageUploads.length).toBeGreaterThan(0)
    for (const upload of device.subImageUploads) {
      expect(upload.opts.flipY ?? false).toBe(false)
      // Glyph coverage is premultiplied so it composites correctly.
      expect(upload.opts.premultiply).toBe(true)
    }
  })
})

describe('drawImage source upload orientation', () => {
  // The label page's invariant, one layer up: a `drawImage` source is top-left
  // origin and the textQuad UV convention walks V downward, so the upload must
  // not flip.
  //
  // A flip here is also backend-dependent. WebGL ignores the pixel-store unpack
  // parameters for an `ImageBitmap` source, so `UNPACK_FLIP_Y_WEBGL` does
  // nothing there while WebGPU's `copyExternalImageToTexture` applies `flipY`.
  // The same bitmap renders upright on WebGL2 and upside down on WebGPU.
  it('asks for no flip on the per-source texture', () => {
    const source = { width: 8, height: 4 } as unknown as CanvasImageSource
    tm.getOrCreateEntry(source)
    expect(device.textureUploads.length).toBe(1)
    expect(device.textureUploads[0]!.opts.flipY ?? false).toBe(false)
  })

  it('re-uploads the restored particle atlas the way its tiles were packed', () => {
    // `#registerAtlasSprite` packs tiles unflipped, so a `rebuild` that flipped
    // the whole page would invert every sprite it restored.
    const sprite = { width: 64, height: 64 } as unknown as HTMLCanvasElement
    ;(sprite as unknown as Record<string, unknown>)[PARTICLE_ATLAS_MARKER] =
      true
    tm.getOrCreateEntry(sprite)
    device.reset()
    tm.rebuild(device)
    for (const upload of device.textureUploads) {
      expect(upload.opts.flipY ?? false).toBe(false)
    }
  })
})

describe('label page instrumentation', () => {
  let device: MockGfxDevice
  let tm: TextureManager
  beforeEach(() => {
    device = new MockGfxDevice()
    tm = new TextureManager(device)
  })

  it('starts with a clean page and no silent failures', () => {
    const snap = tm.snapshot()
    expect(snap.labelPage.size).toBeGreaterThan(0)
    expect(snap.labelPage.usedHeight).toBe(0)
    expect(snap.labelEvictions).toBe(0)
    expect(snap.labelPageWipes).toBe(0)
    expect(snap.labelScaleClamps).toBe(0)
  })

  it('reports the page filling as labels are packed', () => {
    for (let i = 0; i < 20; i++) tm.ensureLabelTexture(`k${i}`, 't', style, 1)
    const snap = tm.snapshot()
    expect(snap.labelPage.usedHeight).toBeGreaterThan(0)
    expect(snap.labelPage.shelfCount).toBeGreaterThan(0)
  })

  it('counts an eviction once the entry cap is passed', () => {
    for (let i = 0; i <= 800; i++) tm.ensureLabelTexture(`k${i}`, 't', style, 1)
    expect(tm.snapshot().labelEvictions).toBeGreaterThan(0)
  })
})

describe('clearLabelCache', () => {
  it('empties the cache so the next request re-rasterizes', () => {
    tm.ensureLabelTexture('base', 'hi', style, 2)
    expect(tm.snapshot().labelCount).toBe(1)

    tm.clearLabelCache()
    expect(tm.snapshot().labelCount).toBe(0)

    const uploadsBefore = device.subImageUploads.length
    tm.ensureLabelTexture('base', 'hi', style, 2)
    expect(device.subImageUploads.length).toBe(uploadsBefore + 1)
  })

  it('frees the atlas page so cleared entries do not leak their span', () => {
    for (let i = 0; i < 20; i++) {
      tm.ensureLabelTexture(`k${i}`, `label ${i}`, style, 2)
    }
    const used = tm.snapshot().labelPage?.usedHeight ?? 0
    expect(used).toBeGreaterThan(0)

    tm.clearLabelCache()
    expect(tm.snapshot().labelPage?.usedHeight ?? 0).toBe(0)
  })

  // Oversized labels get their own texture rather than a page slot, so the
  // clear has to delete them or they leak on every late font load.
  it('deletes dedicated textures for oversized labels', () => {
    tm.ensureLabelTexture('big', 'wide', style, 200)
    tm.clearLabelCache()
    expect(device.deletedTextures.length).toBeGreaterThan(0)
  })

  it('is safe on an empty cache', () => {
    expect(() => tm.clearLabelCache()).not.toThrow()
    expect(tm.snapshot().labelCount).toBe(0)
  })
})
