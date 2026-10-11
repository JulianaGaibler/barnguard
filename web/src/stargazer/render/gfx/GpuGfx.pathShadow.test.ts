import { describe, it, expect } from 'vitest'
import { GpuGfx } from './GpuGfx'
import { MockGfxDevice } from './webgl2/mockGfxDevice'
import { registerPathTessellation } from './PathTessellationRegistry'
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
function squarePath(size = 100): Path2D {
  const path = new Path2D(`M0 0 L${size} 0 L${size} ${size} L0 ${size} Z`)
  registerPathTessellation(path, {
    vertices: new Float32Array([0, 0, size, 0, size, size, 0, size]),
    indices: new Uint16Array([0, 1, 2, 0, 2, 3]),
  })
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

  it('does not crash with a huge blur relative to the shape', async () => {
    const { gfx, device } = makeGpuGfx()
    await baseFrame(gfx, device)
    const path = squarePath(20)
    gfx.shadowPath2D(path, shadow({ blur: 500 }))
    gfx.endFrame()
    expect(() => gfx.processPendingShadowBakes()).not.toThrow()
  })
})
