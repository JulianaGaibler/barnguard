import { describe, expect, it } from 'vitest'
import { GpuGfx } from './GpuGfx'
import { MockGfxDevice } from './webgl2/mockGfxDevice'

// A stage's offscreen target carries depth and stencil together, so a 3D pass
// runs without costing the 2D path its deduplicated translucent strokes. These
// pin that the stencil survives the depth attachment coming and going, and that
// the depth is released again: a stage outlives the scenes drawn on it, so a
// scene that took depth hands it back rather than holding the memory for the
// rest of the stage's life.

function makeGfx(stencil: boolean): { gfx: GpuGfx; device: MockGfxDevice } {
  const canvas = document.createElement('canvas')
  canvas.width = 400
  canvas.height = 300
  const device = new MockGfxDevice()
  return { gfx: new GpuGfx(canvas, device, { stencil, samples: 1 }), device }
}

/** The attachments the frame's main pass actually opened with. */
async function frameAttachments(
  gfx: GpuGfx,
  device: MockGfxDevice,
): Promise<{ depth: boolean; stencil: boolean }> {
  await gfx.whenReady
  device.reset()
  gfx.beginFrame({
    clearColor: '#000000',
    transparent: false,
    pixelW: 400,
    pixelH: 300,
  })
  gfx.endFrame()
  const pass = device.passes.at(-1)
  return { depth: !!pass?.desc.depth, stencil: !!pass?.desc.stencil }
}

describe('GpuGfx depth and stencil', () => {
  it('starts with the stencil it was built with and no depth', async () => {
    const { gfx, device } = makeGfx(true)
    expect(await frameAttachments(gfx, device)).toEqual({
      depth: false,
      stencil: true,
    })
  })

  it('keeps the stencil when a 3D pass turns on', async () => {
    const { gfx, device } = makeGfx(true)
    gfx.enableDepth()
    expect(await frameAttachments(gfx, device)).toEqual({
      depth: true,
      stencil: true,
    })
  })

  it('releases the depth when the 3D pass goes away', async () => {
    const { gfx, device } = makeGfx(true)
    gfx.enableDepth()
    gfx.disableDepth()
    expect(await frameAttachments(gfx, device)).toEqual({
      depth: false,
      stencil: true,
    })
  })

  it('leaves a stage built without stencil without one', async () => {
    const { gfx, device } = makeGfx(false)
    gfx.enableDepth()
    gfx.disableDepth()
    expect(await frameAttachments(gfx, device)).toEqual({
      depth: false,
      stencil: false,
    })
  })

  // Every pipeline bakes the depth-stencil format it was built against, and
  // WebGPU rejects one whose format does not match the pass. Swapping the
  // attachment therefore invalidates all of them, 2D included, so a stage that
  // skipped the re-warm would draw nothing at all rather than degrade.
  it.each([
    ['a stencil-backed stage', true],
    ['a stage with no stencil', false],
  ])('re-warms pipelines for %s', async (_name, stencil) => {
    const { gfx, device } = makeGfx(stencil)
    await gfx.whenReady
    const afterBoot = device.pipelines.length

    gfx.enableDepth()
    expect(gfx.ready).toBe(false)
    await gfx.whenReady
    expect(device.pipelines.length).toBeGreaterThan(afterBoot)

    const afterDepth = device.pipelines.length
    gfx.disableDepth()
    expect(gfx.ready).toBe(false)
    await gfx.whenReady
    expect(device.pipelines.length).toBeGreaterThan(afterDepth)
  })

  it('declares the combined format on the 2D pipelines once depth is attached', async () => {
    const { gfx, device } = makeGfx(true)
    await gfx.whenReady
    gfx.enableDepth()
    await gfx.whenReady

    // The 2D path is painter-ordered and tests nothing, but it shares the pass
    // with the 3D content, so it declares the attachment and leaves both
    // aspects to the backend.
    const built = device.pipelines.slice(-4)
    expect(built.length).toBeGreaterThan(0)
    for (const p of built) {
      expect(p.desc.depthStencil, p.desc.label ?? '2d pipeline').toBe(
        'depth-stencil',
      )
      expect(p.desc.depth).toBeNull()
      expect(p.desc.stencil ?? null).toBeNull()
    }
  })

  it('declares stencil alone on a stage with no 3D content', async () => {
    const { gfx, device } = makeGfx(true)
    await gfx.whenReady
    for (const p of device.pipelines) {
      expect(p.desc.depthStencil, p.desc.label ?? '2d pipeline').toBe('stencil')
    }
  })

  it('hands the 3D pass the combined format to build against', async () => {
    // The mesh pipelines share the 2D pass, so a format of 'depth' here would
    // be rejected against a target that also carries stencil.
    const { gfx } = makeGfx(true)
    await gfx.whenReady
    gfx.enableDepth()
    await gfx.whenReady
    expect(gfx.targetFormat.depthStencil).toBe('depth-stencil')

    gfx.disableDepth()
    await gfx.whenReady
    expect(gfx.targetFormat.depthStencil).toBe('stencil')
  })

  it('rebuilds the target only when the attachments actually change', async () => {
    const { gfx, device } = makeGfx(true)
    await gfx.whenReady
    gfx.enableDepth()
    const afterEnable = device.renderTargets.length
    gfx.enableDepth()
    gfx.enableDepth()
    expect(device.renderTargets.length).toBe(afterEnable)
    gfx.disableDepth()
    gfx.disableDepth()
    expect(device.renderTargets.length).toBe(afterEnable + 1)
  })
})
