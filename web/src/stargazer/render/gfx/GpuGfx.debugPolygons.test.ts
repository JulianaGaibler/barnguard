import { describe, it, expect } from 'vitest'
import { GpuGfx } from './GpuGfx'
import { MockGfxDevice } from './webgl2/mockGfxDevice'

function makeGpuGfx(): { gfx: GpuGfx; device: MockGfxDevice } {
  const canvas = document.createElement('canvas')
  canvas.width = 400
  canvas.height = 300
  const device = new MockGfxDevice()
  const gfx = new GpuGfx(canvas, device)
  return { gfx, device }
}

async function beginFrame(gfx: GpuGfx, device: MockGfxDevice): Promise<void> {
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

describe("GpuGfx 'polygons' debug mode on the outline tessellator", () => {
  it('draws extra stroke-program instances for the tessellated mesh, not the source contour', async () => {
    const pts = new Float32Array([0, 0, 40, 0, 40, 40, 0, 40])
    const style = { color: '#1d1d2b', width: 6, exactJoins: true }

    const { gfx: normalGfx, device: normalDevice } = makeGpuGfx()
    await beginFrame(normalGfx, normalDevice)
    normalGfx.strokePolyline(pts, 4, { ...style, closed: true })
    normalGfx.endFrame()
    const normalStrokeInstances = normalGfx.stats.strokeInstances

    const { gfx, device } = makeGpuGfx()
    await beginFrame(gfx, device)
    gfx.setDebugRenderMode('polygons')
    gfx.strokePolyline(pts, 4, { ...style, closed: true })
    gfx.endFrame()

    // The wireframe draws through the ordinary segment stroker (one instance
    // per triangle edge), on top of the outline tessellation's own fill.
    expect(gfx.stats.strokeInstances).toBeGreaterThan(normalStrokeInstances)
  })

  it('draws nothing extra in normal mode', async () => {
    const pts = new Float32Array([0, 0, 40, 0, 40, 40, 0, 40])
    const { gfx, device } = makeGpuGfx()
    await beginFrame(gfx, device)
    gfx.strokePolyline(pts, 4, {
      color: '#1d1d2b',
      width: 6,
      exactJoins: true,
      closed: true,
    })
    gfx.endFrame()
    expect(gfx.stats.strokeInstances).toBe(0)
  })
})
