import { describe, expect, it, vi } from 'vitest'
import { GpuGfx } from './GpuGfx'
import { addOffscreenDemand } from './offscreenDemand'
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

describe('offscreen surfaces', () => {
  it('refuses to start without demand and warns once', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { gfx } = await makeGfx()
    begin(gfx)
    expect(
      gfx.beginOffscreen({ bounds: { x: 0, y: 0, width: 10, height: 10 } }),
    ).toBe(false)
    expect(gfx.beginOffscreen()).toBe(false)
    gfx.endFrame()
    expect(warn).toHaveBeenCalledTimes(1)
    warn.mockRestore()
  })

  it('renders a surface in its own pass before compositing it into the main pass', async () => {
    const release = addOffscreenDemand()
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
    release()

    // main segment, surface, main segment again, then it closes resolved.
    const passes = device.passes
    expect(passes.map((p) => p.desc.color?.loadOp)).toEqual([
      'clear',
      'clear',
      'load',
    ])
    // The surface is a leaf, so it resolves and drops its samples in one pass.
    expect(passes[1].desc.color?.resolveTarget).toBeDefined()
    expect(passes[1].desc.color?.storeOp).toBe('discard')
    // The first main segment keeps its samples, the last one resolves.
    expect(passes[0].desc.color?.storeOp).toBe('store')
    expect(passes[0].desc.color?.resolveTarget).toBeUndefined()
    expect(passes[2].desc.color?.resolveTarget).toBeDefined()
    // Draws land in the right passes: white, red, the composite, green.
    expect(passes.map((p) => p.drawCount)).toEqual([1, 1, 2])
  })

  it('draws the surface content in its own pixel space', async () => {
    const release = addOffscreenDemand()
    const { gfx, device } = await makeGfx(1)
    begin(gfx)
    gfx.beginOffscreen({ bounds: { x: 50, y: 60, width: 40, height: 40 } })
    gfx.fillRect(50, 60, 40, 40, '#ff0000')
    gfx.endOffscreen()
    // The surface's shift ends with it. A fill after it uses the old origin.
    gfx.fillRect(50, 60, 40, 40, '#00ff00')
    gfx.endFrame()
    release()
    // Single sample: the surface is its own result, so there is no resolve.
    expect(device.passes).toHaveLength(3)
    expect(device.passes.every((p) => !p.desc.color?.resolveTarget)).toBe(true)
    const inside = device.draws[0]
    const snapshot = new Float32Array(inside.bufferSnapshot as ArrayBuffer)
    // The rect's first vertex is at the surface's origin, not at (50, 60).
    expect(snapshot[0]).toBe(0)
    expect(snapshot[1]).toBe(0)
    const after = device.draws[device.draws.length - 1]
    const verts = new Float32Array(after.bufferSnapshot as ArrayBuffer)
    // The first fill took 6 vertices of 5 words, so the second starts at 30.
    expect(verts[30]).toBe(50)
    expect(verts[31]).toBe(60)
  })

  it('nests surfaces and resumes the outer one with its content kept', async () => {
    const release = addOffscreenDemand()
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
    release()
    const loads = device.passes.map((p) => p.desc.color?.loadOp)
    // main, outer, inner, outer again, resolve of the outer, main again.
    expect(loads).toEqual(['clear', 'clear', 'clear', 'load', 'load', 'load'])
    // The outer surface is not a leaf, so it stores its samples first.
    expect(device.passes[1].desc.color?.storeOp).toBe('store')
    expect(device.passes[1].desc.color?.resolveTarget).toBeUndefined()
  })

  it('reuses surfaces from one frame to the next', async () => {
    const release = addOffscreenDemand()
    const { gfx, device } = await makeGfx()
    for (let i = 0; i < 3; i++) {
      begin(gfx)
      gfx.beginOffscreen({ bounds: { x: 0, y: 0, width: 100, height: 100 } })
      gfx.fillRect(0, 0, 10, 10, '#ff0000')
      gfx.endOffscreen()
      gfx.endFrame()
    }
    release()
    // One multisampled target and its resolve target, however many frames.
    expect(device.renderTargets.length).toBeLessThanOrEqual(4)
  })
})
