import { describe, it, expect, vi } from 'vitest'
import { GpuGfx } from './GpuGfx'
import { MockGfxDevice } from './webgl2/mockGfxDevice'
import { registerPathTessellation } from './PathTessellationRegistry'
import { VectorQuality } from '../VectorQuality'
import type { GfxShadowStyle } from './Gfx2D'

function makeCanvas(): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = 400
  c.height = 300
  return c
}

function makeGpuGfx(): { gfx: GpuGfx; device: MockGfxDevice } {
  const canvas = makeCanvas()
  const device = new MockGfxDevice()
  const gfx = new GpuGfx(canvas, device)
  return { gfx, device }
}

/** A registered square Path2D, ready for fillPath2D/shadowPath2D. */
function squarePath(size = 100, opts?: { retained?: boolean }): Path2D {
  const path = new Path2D(`M0 0 L${size} 0 L${size} ${size} L0 ${size} Z`)
  registerPathTessellation(
    path,
    {
      vertices: new Float32Array([0, 0, size, 0, size, size, 0, size]),
      indices: new Uint16Array([0, 1, 2, 0, 2, 3]),
    },
    undefined,
    undefined,
    opts,
  )
  return path
}

async function baseFrame(gfx: GpuGfx, device: MockGfxDevice): Promise<void> {
  await gfx.whenReady
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

const shadow = (overrides: Partial<GfxShadowStyle> = {}): GfxShadowStyle => ({
  color: 'rgba(20,16,40,0.35)',
  offsetX: 0,
  offsetY: 8,
  blur: 32,
  spread: 0,
  inset: false,
  ...overrides,
})

describe('GpuGfx.shadowPath2D', () => {
  it('ticks the unimplemented counter for an unregistered path', async () => {
    const { gfx, device } = makeGpuGfx()
    await baseFrame(gfx, device)
    gfx.shadowPath2D(new Path2D(), shadow())
    gfx.endFrame()
    expect(gfx.unimplemented.shadowPath2D).toBe(1)
  })

  it('draws the hard fallback (a translated fill) on a cold cache', async () => {
    const { gfx, device } = makeGpuGfx()
    await baseFrame(gfx, device)
    const path = squarePath()
    gfx.shadowPath2D(path, shadow())
    gfx.endFrame()
    // One translated fillPath2D draw, nothing from the (not yet baked) mask.
    expect(device.draws.length).toBe(1)
  })

  it('draws the hard fallback with no bake queued for a blur at or below the hard threshold', async () => {
    const { gfx, device } = makeGpuGfx()
    await baseFrame(gfx, device)
    const path = squarePath()
    gfx.shadowPath2D(path, shadow({ blur: 0 }))
    gfx.endFrame()
    expect(device.draws.length).toBe(1)
    // Nothing to bake: the next frame's pre-pass does no GPU work for this.
    const passesBefore = device.passes.length
    gfx.processPendingShadowBakes()
    expect(device.passes.length).toBe(passesBefore)
  })

  it('skips an inset shadow entirely on a cold cache (no hard approximation)', async () => {
    const { gfx, device } = makeGpuGfx()
    await baseFrame(gfx, device)
    const path = squarePath()
    gfx.shadowPath2D(path, shadow({ inset: true }))
    gfx.endFrame()
    expect(device.draws.length).toBe(0)
  })

  it('queues a bake request that the pre-pass later drains', async () => {
    const { gfx, device } = makeGpuGfx()
    await baseFrame(gfx, device)
    const path = squarePath()
    gfx.shadowPath2D(path, shadow())
    gfx.endFrame()

    const passesBefore = device.passes.length
    gfx.processPendingShadowBakes()
    // Raster + two blur passes.
    expect(device.passes.length).toBe(passesBefore + 3)

    // Draining again immediately does nothing: the queue was cleared.
    const passesAfterDrain = device.passes.length
    gfx.processPendingShadowBakes()
    expect(device.passes.length).toBe(passesAfterDrain)
  })

  it('draws the real mask (outset composite, one instance) once baked', async () => {
    const { gfx, device } = makeGpuGfx()
    await baseFrame(gfx, device)
    const path = squarePath()
    gfx.shadowPath2D(path, shadow())
    gfx.endFrame()
    gfx.processPendingShadowBakes()

    await baseFrame(gfx, device)
    gfx.shadowPath2D(path, shadow())
    gfx.endFrame()
    // The outset composite's instanced quad draw, not a translated fill.
    expect(device.draws.length).toBe(1)
    expect(device.draws[0]?.kind).toBe('instancedRange')
  })

  it('draws the real mask through coloredTri (mode 2) for an inset shadow once baked', async () => {
    const { gfx, device } = makeGpuGfx()
    await baseFrame(gfx, device)
    const path = squarePath()
    gfx.shadowPath2D(path, shadow({ inset: true }))
    gfx.endFrame()
    gfx.processPendingShadowBakes()

    await baseFrame(gfx, device)
    gfx.shadowPath2D(path, shadow({ inset: true }))
    gfx.endFrame()
    expect(device.draws.length).toBe(1)
  })

  it('draws the real mask through the retained pipeline for an inset shadow on retained geometry once baked', async () => {
    const { gfx, device } = makeGpuGfx()
    await baseFrame(gfx, device)
    const path = squarePath(100, { retained: true })
    gfx.shadowPath2D(path, shadow({ inset: true }))
    gfx.endFrame()
    gfx.processPendingShadowBakes()

    await baseFrame(gfx, device)
    gfx.shadowPath2D(path, shadow({ inset: true }))
    gfx.endFrame()
    expect(device.draws.length).toBe(1)
    // Indexed draw is only reachable through `#drawRetained`, never the
    // streamed `coloredTri` path.
    expect(device.draws[0].kind).toBe('elements')
  })

  it('does not crash with a huge blur relative to the shape', async () => {
    const { gfx, device } = makeGpuGfx()
    await baseFrame(gfx, device)
    const path = squarePath(20)
    gfx.shadowPath2D(path, shadow({ blur: 500 }))
    gfx.endFrame()
    expect(() => gfx.processPendingShadowBakes()).not.toThrow()
  })

  it('draws an inset shadow from a nearby cached blur rather than nothing', async () => {
    const { gfx, device } = makeGpuGfx()
    await baseFrame(gfx, device)
    const path = squarePath()
    gfx.shadowPath2D(path, shadow({ inset: true, blur: 32 }))
    gfx.endFrame()
    gfx.processPendingShadowBakes()

    // A blur a fifth of an octave off has no entry of its own, so it stands
    // on the cached one instead of dropping the glow for the frame.
    await baseFrame(gfx, device)
    gfx.shadowPath2D(path, shadow({ inset: true, blur: 36 }))
    gfx.endFrame()
    expect(device.draws.length).toBe(1)
  })

  it('leaves an inset shadow unpainted when every cached blur is too far off', async () => {
    const { gfx, device } = makeGpuGfx()
    await baseFrame(gfx, device)
    const path = squarePath()
    gfx.shadowPath2D(path, shadow({ inset: true, blur: 32 }))
    gfx.endFrame()
    gfx.processPendingShadowBakes()

    // Past MASK_SUBSTITUTE_BLUR_OCTAVES, so no substitution.
    await baseFrame(gfx, device)
    gfx.shadowPath2D(path, shadow({ inset: true, blur: 200 }))
    gfx.endFrame()
    expect(device.draws.length).toBe(0)
  })

  it('queues the exact bake while a substitute stands in, and converges', async () => {
    const { gfx, device } = makeGpuGfx()
    await baseFrame(gfx, device)
    const path = squarePath()
    gfx.shadowPath2D(path, shadow({ blur: 32 }))
    gfx.endFrame()
    gfx.processPendingShadowBakes()
    expect(gfx.textureInspector.snapshot().shadowMasks.length).toBe(1)

    await baseFrame(gfx, device)
    gfx.shadowPath2D(path, shadow({ blur: 36 }))
    gfx.endFrame()
    // The substitute is drawn AND the real mask is queued behind it.
    const passesBefore = device.passes.length
    gfx.processPendingShadowBakes()
    expect(device.passes.length).toBe(passesBefore + 3)
    expect(gfx.textureInspector.snapshot().shadowMasks.length).toBe(2)
  })

  // The wedge: a full byte budget where every entry is still inside its
  // eviction window means no bake can ever land again. Nothing reports it, the
  // masks simply stop appearing.
  it('does not wedge the budget behind masks no draw ever asked for', async () => {
    const canvas = makeCanvas()
    const device = new MockGfxDevice()
    const quality = new VectorQuality()
    const gfx = new GpuGfx(canvas, device, { vectorQuality: quality })
    await baseFrame(gfx, device)
    const path = squarePath()

    gfx.shadowPath2D(path, shadow())
    gfx.endFrame()
    gfx.processPendingShadowBakes()
    const oneMaskBytes =
      gfx.textureInspector.snapshot().shadowMasks[0]?.bytes ?? 0
    expect(oneMaskBytes).toBeGreaterThan(0)

    // Past MASK_EVICT_FRAMES_UNUSED, with no draw having asked for the mask.
    for (let i = 0; i < 4; i++) {
      await baseFrame(gfx, device)
      gfx.endFrame()
      gfx.processPendingShadowBakes()
    }

    // Room for exactly one mask, so a second path's bake has to reclaim the
    // first path's or not land at all.
    quality.shadowMaskBudgetBytes = oneMaskBytes
    const other = squarePath()
    await baseFrame(gfx, device)
    gfx.shadowPath2D(other, shadow())
    gfx.endFrame()
    gfx.processPendingShadowBakes()

    // `stats` mirrors the cache's counters at `endFrame`, so read it after one.
    await baseFrame(gfx, device)
    gfx.endFrame()
    expect(gfx.stats.maskBakes).toBe(2)
    const masks = gfx.textureInspector.snapshot().shadowMasks
    expect(masks.length).toBe(1)
    expect(masks[0].bakedFrame).toBeGreaterThan(1)
  })

  it('does not grant the long eviction window to a mask that only stood in', async () => {
    const canvas = makeCanvas()
    const device = new MockGfxDevice()
    const quality = new VectorQuality()
    const gfx = new GpuGfx(canvas, device, { vectorQuality: quality })
    await baseFrame(gfx, device)
    const path = squarePath()

    gfx.shadowPath2D(path, shadow({ blur: 32 }))
    gfx.endFrame()
    gfx.processPendingShadowBakes()
    const oneMaskBytes =
      gfx.textureInspector.snapshot().shadowMasks[0]?.bytes ?? 0

    // Room for one mask, then a blur that moves every frame. Each new radius
    // stands on the previous mask, and counting that as use would put the
    // whole backlog behind the long window and stop every later bake.
    quality.shadowMaskBudgetBytes = oneMaskBytes
    for (let i = 1; i <= 12; i++) {
      await baseFrame(gfx, device)
      gfx.shadowPath2D(path, shadow({ blur: 32 + i }))
      gfx.endFrame()
      gfx.processPendingShadowBakes()
    }

    await baseFrame(gfx, device)
    gfx.endFrame()
    expect(gfx.stats.maskBakes).toBeGreaterThan(2)
  })

  it('keeps an inset shadow painted through a zoom its bakes can keep pace with', async () => {
    const canvas = makeCanvas()
    const device = new MockGfxDevice()
    const gfx = new GpuGfx(canvas, device)
    await gfx.whenReady
    const path = squarePath()
    const BLUR_CSS = 36

    const frame = (scale: number): number => {
      device.reset()
      gfx.beginFrame({
        clearColor: '#0d1a2c',
        transparent: false,
        pixelW: 400,
        pixelH: 300,
      })
      gfx.setBaseTransform(scale, 0, 0, scale, 0, 0)
      gfx.setAlpha(1)
      // A screen-space radius: in local units it tracks the camera scale, so
      // every frame of a zoom asks for a blur the cache has no entry for.
      gfx.shadowPath2D(path, shadow({ inset: true, blur: BLUR_CSS / scale }))
      gfx.endFrame()
      const drawn = device.draws.length
      gfx.processPendingShadowBakes()
      return drawn
    }

    frame(1)
    frame(1)
    expect(frame(1)).toBe(1)

    // 3x over ten frames, well past half an octave in total.
    const ratio = Math.pow(3, 1 / 10)
    let unpainted = 0
    for (let i = 1; i <= 10; i++) {
      if (frame(Math.pow(ratio, i)) === 0) unpainted++
    }
    expect(unpainted).toBe(0)
  })

  it('does not warn when only the scale bucket moves', async () => {
    // A world-space shadow holds its blur while the camera zooms, so the only
    // thing missing from the cache is the resolution bucket. Warning here
    // would tell a caller to apply a fix it has already applied.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const canvas = makeCanvas()
      const device = new MockGfxDevice()
      const gfx = new GpuGfx(canvas, device)
      await gfx.whenReady
      const path = squarePath()
      // Half an octave per frame, so every frame lands in a bucket the cache
      // has never baked and has to substitute. Anything coarser lets the exact
      // key hit in between and the run never reaches the warning threshold.
      for (let i = 0; i < 24; i++) {
        const scale = Math.pow(2, i / 2)
        device.reset()
        gfx.beginFrame({
          clearColor: '#0d1a2c',
          transparent: false,
          pixelW: 400,
          pixelH: 300,
        })
        gfx.setBaseTransform(scale, 0, 0, scale, 0, 0)
        gfx.setAlpha(1)
        gfx.shadowPath2D(path, shadow({ inset: true, blur: 32 }))
        gfx.endFrame()
        gfx.processPendingShadowBakes()
      }
      expect(warn).not.toHaveBeenCalled()
    } finally {
      warn.mockRestore()
    }
  })

  it('stands in across any bucket distance at the requested blur', async () => {
    const canvas = makeCanvas()
    const device = new MockGfxDevice()
    const gfx = new GpuGfx(canvas, device)
    await gfx.whenReady
    const path = squarePath()

    // Bake at scale 1, then jump far enough that no adjacent bucket exists.
    const frame = (scale: number): number => {
      device.reset()
      gfx.beginFrame({
        clearColor: '#0d1a2c',
        transparent: false,
        pixelW: 400,
        pixelH: 300,
      })
      gfx.setBaseTransform(scale, 0, 0, scale, 0, 0)
      gfx.setAlpha(1)
      gfx.shadowPath2D(path, shadow({ inset: true, blur: 32 }))
      gfx.endFrame()
      const drawn = device.draws.length
      gfx.processPendingShadowBakes()
      return drawn
    }
    frame(1)
    frame(1)
    // Six half-octave buckets away, well past the +/-1 adjacency.
    expect(frame(8)).toBe(1)
  })

  it('warns once when a blur churns faster than the cache can follow', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const canvas = makeCanvas()
      const device = new MockGfxDevice()
      const gfx = new GpuGfx(canvas, device)
      await gfx.whenReady
      const path = squarePath()
      for (let i = 0; i < 40; i++) {
        device.reset()
        gfx.beginFrame({
          clearColor: '#0d1a2c',
          transparent: false,
          pixelW: 400,
          pixelH: 300,
        })
        gfx.setBaseTransform(1, 0, 0, 1, 0, 0)
        gfx.setAlpha(1)
        gfx.shadowPath2D(path, shadow({ inset: true, blur: 32 + i * 0.1 }))
        gfx.endFrame()
        gfx.processPendingShadowBakes()
      }
      expect(warn).toHaveBeenCalledTimes(1)
      expect(warn.mock.calls[0][0]).toContain("strokeSpace: 'world'")
    } finally {
      warn.mockRestore()
    }
  })

  // A backend may hold the frame's passes on one command encoder and submit
  // them together, so two bakes sharing uniform bytes both read whatever was
  // written last: one mask comes out right and the rest rasterize the wrong
  // shape, which an inset shadow then paints as a solid fill or not at all.
  it('bakes each mask in a frame from its own uniform slice', async () => {
    const { gfx, device } = makeGpuGfx()
    await baseFrame(gfx, device)
    gfx.shadowPath2D(squarePath(100), shadow({ blur: 8 }))
    gfx.shadowPath2D(squarePath(60), shadow({ blur: 8 }))
    gfx.endFrame()

    device.reset()
    gfx.processPendingShadowBakes()
    const bakeDraws = [...device.draws]
    await baseFrame(gfx, device)
    gfx.endFrame()
    expect(gfx.stats.maskBakes).toBe(2)

    // Offsets into the one buffer a bind group holds, grouped by that group.
    // The raster group is reused across bakes, so its offsets have to differ.
    const byGroup = new Map<unknown, number[]>()
    for (const draw of bakeDraws) {
      for (const group of draw.bindGroups ?? []) {
        const offset = group.dynamicOffsets?.[0]
        if (offset === undefined) continue
        const seen = byGroup.get(group.bindGroup) ?? []
        seen.push(offset)
        byGroup.set(group.bindGroup, seen)
      }
    }
    const reused = [...byGroup.values()].filter((o) => o.length > 1)
    expect(reused.length).toBeGreaterThan(0)
    for (const offsets of reused) {
      expect(new Set(offsets).size).toBe(offsets.length)
    }
  })

  it('warms the masks a camera scale it has not reached will ask for', async () => {
    const { gfx, device } = makeGpuGfx()
    await baseFrame(gfx, device)
    const path = squarePath()
    gfx.warmPathShadows([2])
    gfx.shadowPath2D(path, shadow({ inset: true, blur: 8 }))
    gfx.endFrame()
    expect(gfx.pendingPathShadowWarmups).toBe(1)

    // Collection is one frame only: the factors clear at `endFrame`, so a
    // second frame's draws queue nothing more.
    for (let i = 0; i < 3; i++) {
      gfx.processPendingShadowBakes()
      await baseFrame(gfx, device)
      gfx.shadowPath2D(path, shadow({ inset: true, blur: 8 }))
      gfx.endFrame()
    }
    expect(gfx.pendingPathShadowWarmups).toBe(0)

    // The zoom arrives. Its mask is already cached, so nothing bakes.
    const bakesBefore = gfx.stats.maskBakes
    await baseFrame(gfx, device)
    gfx.setBaseTransform(2, 0, 0, 2, 0, 0)
    gfx.shadowPath2D(path, shadow({ inset: true, blur: 8 }))
    gfx.endFrame()
    device.reset()
    gfx.processPendingShadowBakes()
    expect(device.draws.length).toBe(0)
    await baseFrame(gfx, device)
    gfx.endFrame()
    expect(gfx.stats.maskBakes).toBe(bakesBefore)
  })

  it('warms nothing for a factor inside the current scale bucket', async () => {
    const { gfx, device } = makeGpuGfx()
    await baseFrame(gfx, device)
    // A quarter octave either side of 1 is the same bucket, so the mask the
    // live draw already asks for is the one such a factor would want.
    gfx.warmPathShadows([1.05])
    gfx.shadowPath2D(squarePath(), shadow({ inset: true, blur: 8 }))
    gfx.endFrame()
    expect(gfx.pendingPathShadowWarmups).toBe(0)
  })

  it('lists a baked mask in the texture inspector snapshot', async () => {
    const { gfx, device } = makeGpuGfx()
    await baseFrame(gfx, device)
    const path = squarePath()
    gfx.shadowPath2D(path, shadow())
    gfx.endFrame()
    expect(gfx.textureInspector.snapshot().shadowMasks).toEqual([])

    gfx.processPendingShadowBakes()
    const masks = gfx.textureInspector.snapshot().shadowMasks
    expect(masks.length).toBe(1)
    expect(masks[0].width).toBeGreaterThan(0)
    expect(masks[0].bytes).toBeGreaterThan(0)
  })
})
