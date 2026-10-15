import { describe, expect, it } from 'vitest'
import { GpuGfx } from './GpuGfx'
import { MockGfxDevice } from './webgl2/mockGfxDevice'

async function makeGfx(
  samples = 4,
): Promise<{ gfx: GpuGfx; device: MockGfxDevice }> {
  const canvas = document.createElement('canvas')
  canvas.width = 400
  canvas.height = 300
  const device = new MockGfxDevice()
  const gfx = new GpuGfx(canvas, device, { stencil: true, samples })
  await gfx.whenReady
  device.reset()
  return { gfx, device }
}

function begin(gfx: GpuGfx): void {
  gfx.beginFrame({
    clearColor: '#000000',
    transparent: false,
    pixelW: 400,
    pixelH: 300,
  })
  gfx.setBaseTransform(1, 0, 0, 1, 0, 0)
  gfx.setAlpha(1)
}

describe('depth and stencil store ops', () => {
  it('discards depth and stencil in every pass', async () => {
    const { gfx, device } = await makeGfx()
    gfx.enableDepth()
    await gfx.whenReady
    device.reset()
    begin(gfx)
    gfx.fillRect(0, 0, 4, 4, '#ffffff')
    gfx.beginOffscreen({ bounds: { x: 0, y: 0, width: 50, height: 50 } })
    gfx.fillRect(0, 0, 50, 50, '#ff0000')
    gfx.endOffscreen()
    gfx.endFrame()
    const passes = device.passes.map((p) => p.desc)
    expect(passes).toHaveLength(2)
    expect(passes.map((d) => d.depth?.storeOp)).toEqual(['discard', 'discard'])
    expect(passes.map((d) => d.stencil?.storeOp)).toEqual([
      'discard',
      'discard',
    ])
  })
})

describe('offscreen surfaces', () => {
  it('renders a surface in its own pass before the main pass', async () => {
    const { gfx, device } = await makeGfx()
    begin(gfx)
    gfx.fillRect(0, 0, 4, 4, '#ffffff')
    expect(
      gfx.beginOffscreen({
        bounds: { x: 10, y: 20, width: 100, height: 50 },
        opacity: 0.5,
      }),
    ).toBe(true)
    gfx.fillRect(10, 20, 100, 50, '#ff0000')
    expect(gfx.endOffscreen()).toBeNull()
    gfx.fillRect(0, 0, 4, 4, '#00ff00')
    gfx.endFrame()

    const passes = device.passes
    // The surface comes first, so the main pass is never interrupted.
    expect(passes).toHaveLength(2)
    expect(passes.map((p) => p.desc.color?.loadOp)).toEqual(['clear', 'clear'])
    // Both resolve and drop their samples in the pass that draws them.
    for (const p of passes) {
      expect(p.desc.color?.resolveTarget).toBeDefined()
      expect(p.desc.color?.storeOp).toBe('discard')
    }
    // The surface draws its red fill. The main pass draws the two small fills
    // and the composite.
    expect(passes[0].drawCount).toBe(1)
    expect(passes[1].drawCount).toBeGreaterThanOrEqual(2)
  })

  it('draws the surface content in its own pixel space', async () => {
    const { gfx, device } = await makeGfx(1)
    begin(gfx)
    gfx.beginOffscreen({ bounds: { x: 50, y: 60, width: 40, height: 40 } })
    gfx.fillRect(50, 60, 40, 40, '#ff0000')
    gfx.endOffscreen()
    // The surface's shift ends with it. A fill after it uses the old origin.
    gfx.fillRect(50, 60, 40, 40, '#00ff00')
    gfx.endFrame()
    // Single sample: the surface is its own result, so there is no resolve.
    expect(device.passes).toHaveLength(2)
    expect(device.passes.every((p) => !p.desc.color?.resolveTarget)).toBe(true)
    const inside = device.draws[0]
    const snapshot = new Float32Array(inside.bufferSnapshot as ArrayBuffer)
    // The rect's first vertex is at the surface's origin, not at (50, 60).
    expect(snapshot[0]).toBe(0)
    expect(snapshot[1]).toBe(0)
    const after = device.draws[device.draws.length - 1]
    const verts = new Float32Array(after.bufferSnapshot as ArrayBuffer)
    // The first fill took 6 vertices of 6 words, so the second starts at 36.
    expect(verts[36]).toBe(50)
    expect(verts[37]).toBe(60)
  })

  it('renders a nested surface before the surface that contains it', async () => {
    const { gfx, device } = await makeGfx()
    begin(gfx)
    gfx.beginOffscreen()
    gfx.fillRect(0, 0, 10, 10, '#ff0000')
    gfx.beginOffscreen({ bounds: { x: 0, y: 0, width: 50, height: 50 } })
    gfx.fillRect(0, 0, 50, 50, '#0000ff')
    gfx.endOffscreen()
    gfx.fillRect(20, 20, 10, 10, '#00ff00')
    gfx.endOffscreen()
    gfx.endFrame()
    // Inner, outer, main, each in one pass that starts clear.
    expect(device.passes.map((p) => p.desc.color?.loadOp)).toEqual([
      'clear',
      'clear',
      'clear',
    ])
    // The inner surface holds the blue fill alone.
    expect(device.passes[0].drawCount).toBe(1)
    // The outer surface holds the red and green fills and the inner composite.
    expect(device.passes[1].drawCount).toBeGreaterThanOrEqual(2)
    expect(device.passes[2].drawCount).toBe(1)
  })

  it('places nested surface content by the origins of both surfaces', async () => {
    const { gfx, device } = await makeGfx(1)
    begin(gfx)
    gfx.beginOffscreen({ bounds: { x: 100, y: 50, width: 200, height: 200 } })
    gfx.beginOffscreen({ bounds: { x: 150, y: 80, width: 40, height: 40 } })
    // Given in target pixels, as the compose walk does.
    gfx.setBaseTransform(1, 0, 0, 1, 0, 0)
    gfx.fillRect(150, 80, 40, 40, '#ff0000')
    gfx.endOffscreen()
    gfx.endOffscreen()
    gfx.endFrame()
    const inner = device.draws[0]
    const verts = new Float32Array(inner.bufferSnapshot as ArrayBuffer)
    // The rect starts at the inner surface's own origin.
    expect(verts[0]).toBe(0)
    expect(verts[1]).toBe(0)
  })

  it('renders a retained surface before the surface that composites it', async () => {
    const { gfx, device } = await makeGfx()
    begin(gfx)
    gfx.beginOffscreen({ retain: true })
    gfx.fillRect(0, 0, 50, 50, '#ffffff')
    const mask = gfx.endOffscreen()
    expect(mask).not.toBeNull()
    gfx.beginOffscreen()
    gfx.fillRect(0, 0, 50, 50, '#ff0000')
    gfx.drawOffscreen(mask!, { blend: 'destination-in' })
    gfx.endOffscreen()
    gfx.endFrame()
    expect(device.passes).toHaveLength(3)
    expect(device.passes.map((p) => p.drawCount)).toEqual([1, 2, 1])
  })

  it('closes a surface left open at the end of the frame', async () => {
    const { gfx, device } = await makeGfx()
    begin(gfx)
    gfx.beginOffscreen()
    gfx.fillRect(0, 0, 10, 10, '#ff0000')
    gfx.endFrame()
    expect(device.passes).toHaveLength(2)
    expect(device.passes[0].drawCount).toBe(1)
  })

  it('opens and clears the main pass in an empty frame', async () => {
    const { gfx, device } = await makeGfx()
    begin(gfx)
    gfx.endFrame()
    expect(device.passes).toHaveLength(1)
    expect(device.passes[0].desc.color?.loadOp).toBe('clear')
  })

  it('runs the main prelude inside the main pass, before the recorded draws', async () => {
    const { gfx, device } = await makeGfx()
    const order: string[] = []
    begin(gfx)
    gfx.fillRect(0, 0, 10, 10, '#ff0000')
    gfx.setMainPrelude(() => {
      order.push(`prelude:${device.passes.length}:${device.draws.length}`)
    })
    gfx.endFrame()
    // The main pass is already open and nothing has been drawn into it yet.
    expect(order).toEqual(['prelude:1:0'])
    expect(device.passes).toHaveLength(1)
    expect(device.draws).toHaveLength(1)
  })

  it('reuses surfaces from one frame to the next', async () => {
    const { gfx, device } = await makeGfx()
    for (let i = 0; i < 3; i++) {
      begin(gfx)
      gfx.beginOffscreen({ bounds: { x: 0, y: 0, width: 100, height: 100 } })
      gfx.fillRect(0, 0, 10, 10, '#ff0000')
      gfx.endOffscreen()
      gfx.endFrame()
    }
    // One multisampled target and its resolve target, however many frames.
    expect(device.renderTargets.length).toBeLessThanOrEqual(4)
  })
})
