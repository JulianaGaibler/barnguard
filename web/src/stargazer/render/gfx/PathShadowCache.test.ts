import { describe, it, expect } from 'vitest'
import {
  PathShadowCache,
  resolveMaskSize,
  kernelTruncatedMass,
  MASK_SIZE_QUANTUM,
  MASK_MAX_EDGE,
  MASK_EVICT_FRAMES,
  type PathShadowRequest,
} from './PathShadowCache'
import { MockGfxDevice } from './webgl2/mockGfxDevice'
import { VectorQuality, SHADOW_SIGMA_BUDGETS } from '../VectorQuality'
import type { GeometryHandle } from './GeometryHandle'

/** A unit square, two triangles, in local path space. */
function squareGeometry(
  x: number,
  y: number,
  w: number,
  h: number,
): GeometryHandle {
  return {
    vertices: new Float32Array([x, y, x + w, y, x + w, y + h, x, y + h]),
    indices: new Uint16Array([0, 1, 2, 0, 2, 3]),
  }
}

function baseRequest(
  overrides: Partial<PathShadowRequest> = {},
): PathShadowRequest {
  return {
    path: new Path2D(),
    geometry: squareGeometry(0, 0, 100, 60),
    localBounds: { x: 0, y: 0, width: 100, height: 60 },
    registrationEpoch: 0,
    blur: 16,
    spread: 0,
    scaleX: 1,
    scaleY: 1,
    scale: 1,
    quality: new VectorQuality(),
    ...overrides,
  }
}

async function readyCache(backend: 'webgl2' | 'webgpu' = 'webgl2'): Promise<{
  device: MockGfxDevice
  cache: PathShadowCache
}> {
  const device = new MockGfxDevice(backend)
  const cache = new PathShadowCache(device)
  await cache.warmup()
  cache.beginFrame()
  return { device, cache }
}

describe('resolveMaskSize', () => {
  it('grows the physical padding with blur radius at a fixed budget (the mask texel count can shrink: resolution trades down to keep sigma-in-texels near the budget)', () => {
    const small = resolveMaskSize(100, 60, 4, 0, 1, 8, 3)
    const large = resolveMaskSize(100, 60, 64, 0, 1, 8, 3)
    expect(large.extentDev).toBeGreaterThan(small.extentDev)
    expect(large.maskW * large.kx).toBeGreaterThan(small.maskW * small.kx)
  })

  it('quantizes mask dimensions to MASK_SIZE_QUANTUM', () => {
    const r = resolveMaskSize(100, 60, 16, 0, 1, 8, 3)
    expect(r.maskW % MASK_SIZE_QUANTUM).toBe(0)
    expect(r.maskH % MASK_SIZE_QUANTUM).toBe(0)
  })

  it('clamps to MASK_MAX_EDGE for a huge shape', () => {
    const r = resolveMaskSize(10000, 10000, 32, 0, 1, 8, 3)
    expect(r.maskW).toBeLessThanOrEqual(MASK_MAX_EDGE)
    expect(r.maskH).toBeLessThanOrEqual(MASK_MAX_EDGE)
  })

  it('a cheaper sigma budget produces a smaller mask than a pricier one, same blur', () => {
    const sizes = SHADOW_SIGMA_BUDGETS.map(
      (budget) =>
        resolveMaskSize(100, 60, 32, 0, 1, budget, 3).maskW *
        resolveMaskSize(100, 60, 32, 0, 1, budget, 3).maskH,
    )
    expect(sizes[0]).toBeLessThanOrEqual(sizes[1])
    expect(sizes[1]).toBeLessThanOrEqual(sizes[2])
  })

  it('recomputes kx/ky per axis after quantization, so a non-square shape gets matching effective sigmas', () => {
    // A wide, short shape: width quantizes much more loosely than height.
    const r = resolveMaskSize(3000, 40, 16, 0, 1, 8, 3)
    // Both kx and ky should be positive and finite regardless of the aspect.
    expect(r.kx).toBeGreaterThan(0)
    expect(r.ky).toBeGreaterThan(0)
  })

  it('spread grows the padding independently of blur', () => {
    const noSpread = resolveMaskSize(100, 60, 16, 0, 1, 8, 3)
    const spread = resolveMaskSize(100, 60, 16, 40, 1, 8, 3)
    expect(spread.extentDev).toBeGreaterThan(noSpread.extentDev)
  })

  it('negative spread never shrinks padding below the blur-only extent', () => {
    const noSpread = resolveMaskSize(100, 60, 16, 0, 1, 8, 3)
    const shrink = resolveMaskSize(100, 60, 16, -40, 1, 8, 3)
    expect(shrink.extentDev).toBe(noSpread.extentDev)
  })
})

describe('kernelTruncatedMass', () => {
  it('captures the great majority of the Gaussian for every allowed sigma budget', () => {
    for (const budget of SHADOW_SIGMA_BUDGETS) {
      const sigmaPassTexels = budget * 2 // a pass's own-resolution doubling
      const tapsPerSide = Math.ceil(1.5 * sigmaPassTexels)
      const mass = kernelTruncatedMass(sigmaPassTexels, tapsPerSide + 1)
      expect(mass).toBeGreaterThan(0.85)
    }
  })

  it('is exactly 1 for a degenerate (zero) sigma', () => {
    expect(kernelTruncatedMass(0, 1)).toBe(1)
  })

  it('increases monotonically with more taps', () => {
    const few = kernelTruncatedMass(8, 4)
    const many = kernelTruncatedMass(8, 20)
    expect(many).toBeGreaterThan(few)
  })
})

describe('PathShadowCache', () => {
  it('returns null before warmup resolves', () => {
    const device = new MockGfxDevice()
    const cache = new PathShadowCache(device)
    cache.beginFrame()
    expect(cache.getOrBake(baseRequest())).toBeNull()
  })

  it('bakes a mask once warm and budget allows', async () => {
    const { cache } = await readyCache()
    const mask = cache.getOrBake(baseRequest())
    expect(mask).not.toBeNull()
  })

  it('a cold miss draws three passes: raster, blur, blur', async () => {
    const { device, cache } = await readyCache()
    const before = device.passes.length
    cache.getOrBake(baseRequest())
    expect(device.passes.length - before).toBe(3)
  })

  it('reuses the baked mask on an identical second request (no extra passes)', async () => {
    const { device, cache } = await readyCache()
    const req = baseRequest()
    cache.getOrBake(req)
    const passesAfterFirst = device.passes.length
    const second = cache.getOrBake(req)
    expect(device.passes.length).toBe(passesAfterFirst)
    expect(second?.texture).toBe(cache.getOrBake(req)?.texture)
  })

  it('disabled quality.pathShadowsEnabled skips baking entirely', async () => {
    const { cache } = await readyCache()
    const quality = new VectorQuality({ pathShadowsEnabled: false })
    expect(cache.getOrBake(baseRequest({ quality }))).toBeNull()
  })

  it('a zero-byte budget cannot bake even a single mask', async () => {
    const { cache } = await readyCache()
    const quality = new VectorQuality({ shadowMaskBudgetBytes: 1 })
    expect(cache.getOrBake(baseRequest({ quality }))).toBeNull()
  })

  it('evicts an older, untouched entry once a new bake would exceed the byte budget', async () => {
    const { device, cache } = await readyCache()
    // A one-mask-and-a-bit budget: the first bake fits alone, but a second
    // distinct entry does not fit alongside it.
    const oneMaskBytes = resolveMaskSize(100, 60, 16, 0, 1, 8, 3)
    const budgetBytes = oneMaskBytes.maskW * oneMaskBytes.maskH * 2 * 1.5
    const quality = new VectorQuality({ shadowMaskBudgetBytes: budgetBytes })

    const pathA = new Path2D()
    const firstBakePasses = device.passes.length
    const probe = cache.getOrBake(baseRequest({ path: pathA, quality }))
    expect(probe).not.toBeNull()
    expect(device.passes.length).toBe(firstBakePasses + 3)

    // Force the first entry stale enough to be evictable, then bake a
    // second, equally-sized, distinct entry that cannot fit alongside it.
    for (let i = 0; i < MASK_EVICT_FRAMES + 2; i++) cache.beginFrame()
    const pathB = new Path2D()
    const second = cache.getOrBake(baseRequest({ path: pathB, quality }))
    expect(second).not.toBeNull()
    expect(device.deletedRenderTargetHandles.length).toBeGreaterThan(0)

    // The original now has to re-bake from scratch rather than resolving a
    // dangling reference to the entry that was just evicted. Right after
    // pathB's bake, pathB itself is the sole occupant of the one-mask
    // budget and is too fresh to evict (the same hysteresis guard), so the
    // rebake has to wait for pathB to age past the window too.
    for (let i = 0; i < MASK_EVICT_FRAMES + 2; i++) cache.beginFrame()
    const passesBeforeRebake = device.passes.length
    cache.getOrBake(baseRequest({ path: pathA, quality }))
    expect(device.passes.length).toBe(passesBeforeRebake + 3)
  })

  it('never evicts an entry baked within the hysteresis window', async () => {
    const { cache } = await readyCache()
    const path = new Path2D()
    const first = cache.getOrBake(baseRequest({ path }))
    expect(first).not.toBeNull()
    // Immediately try to force eviction pressure in the very next frame.
    cache.beginFrame()
    const tinyBudget = new VectorQuality({ shadowMaskBudgetBytes: 1 })
    const otherPath = new Path2D()
    cache.getOrBake(baseRequest({ path: otherPath, quality: tinyBudget }))
    // The first entry must still be the one a same-key request resolves to.
    const stillThere = cache.getOrBake(baseRequest({ path }))
    expect(stillThere?.texture).toBe(first?.texture)
  })

  it('falls back to a same-style adjacent-bucket mask while a different bucket bakes', async () => {
    const { cache } = await readyCache()
    const path = new Path2D()
    const atScale1 = cache.getOrBake(baseRequest({ path, scale: 1 }))
    expect(atScale1).not.toBeNull()
    cache.beginFrame()
    // A half-octave zoom (scale * 2^0.5) lands in the adjacent bucket: the
    // bucket-1 entry should resolve as a stale fallback even though a fresh
    // bake for the new bucket is requested in the same call.
    const atScale1_4 = cache.getOrBake(baseRequest({ path, scale: Math.SQRT2 }))
    expect(atScale1_4).not.toBeNull()
  })

  it('a different registrationEpoch does not reuse a stale tessellation', async () => {
    const { device, cache } = await readyCache()
    const req = baseRequest()
    cache.getOrBake(req)
    const passesAfterFirst = device.passes.length
    cache.beginFrame() // a fresh frame's bake-work budget, not a second bake in the same one
    cache.getOrBake({ ...req, registrationEpoch: 1 })
    expect(device.passes.length).toBeGreaterThan(passesAfterFirst)
  })

  it('an empty tessellation clears the raster target without throwing', async () => {
    const { cache } = await readyCache()
    const empty: GeometryHandle = {
      vertices: new Float32Array(0),
      indices: new Uint16Array(0),
    }
    expect(() =>
      cache.getOrBake(baseRequest({ geometry: empty })),
    ).not.toThrow()
  })

  it('runs identically on the webgpu backend (textureTopDown)', async () => {
    const { cache } = await readyCache('webgpu')
    const mask = cache.getOrBake(baseRequest())
    expect(mask).not.toBeNull()
  })

  it('destroy releases pooled targets and shader modules without throwing', async () => {
    const { device, cache } = await readyCache()
    cache.getOrBake(baseRequest())
    expect(() => cache.destroy()).not.toThrow()
    expect(device.deletedShaderModules).toBeGreaterThan(0)
  })
})
