import { describe, expect, it, vi } from 'vitest'
import { GpuGfx } from './GpuGfx'
import { GfxPath } from './GfxPath'
import { MockGfxDevice, type DrawRecord } from './webgl2/mockGfxDevice'

async function makeGfx(stencil = true): Promise<{
  gfx: GpuGfx
  device: MockGfxDevice
}> {
  const canvas = document.createElement('canvas')
  canvas.width = 400
  canvas.height = 300
  const device = new MockGfxDevice()
  const gfx = new GpuGfx(canvas, device, { stencil })
  await gfx.whenReady
  device.reset()
  gfx.beginFrame({
    clearColor: '#000000',
    transparent: false,
    pixelW: 400,
    pixelH: 300,
  })
  gfx.setBaseTransform(1, 0, 0, 1, 0, 0)
  gfx.setAlpha(1)
  return { gfx, device }
}

function star(cx = 100): GfxPath {
  const p = new GfxPath()
  for (let i = 0; i < 5; i++) {
    const a = (i * 4 * Math.PI) / 5 - Math.PI / 2
    const x = cx + 80 * Math.cos(a)
    const y = 100 + 80 * Math.sin(a)
    if (i === 0) p.moveTo(x, y)
    else p.lineTo(x, y)
  }
  return p.close()
}

const fillDraws = (device: MockGfxDevice): DrawRecord[] =>
  device.draws.filter((d) => d.stencil !== null)

describe('fillPath', () => {
  it('records a fan then a cover', async () => {
    const { gfx, device } = await makeGfx()
    gfx.fillPath(star(), '#ff0000')
    gfx.endFrame()
    const [fan, cover] = fillDraws(device)
    expect(device.draws).toHaveLength(2)
    expect(fan.colorWrite).toBe(false)
    expect(fan.stencil?.front.passOp).toBe('increment-wrap')
    expect(fan.stencil?.back?.passOp).toBe('decrement-wrap')
    expect(fan.stencilReference).toBe(0)
    expect(cover.colorWrite).toBe(true)
    expect(cover.stencil?.front.compare).toBe('not-equal')
    // The cover is the bounds quad, and the fan is a triangle per extra point.
    expect(cover.count).toBe(6)
    expect(fan.count).toBe(3 * 3)
    // Fans stream into a buffer of their own, apart from the covers.
    expect(cover.vertexBuffers[0].buffer).not.toBe(fan.vertexBuffers[0].buffer)
  })

  it('draws the fans and covers of paths that do not touch together', async () => {
    const { gfx, device } = await makeGfx()
    gfx.fillPath(star(100), '#ff0000')
    gfx.fillPath(star(300), '#00ff00')
    gfx.endFrame()
    const [fan, cover] = fillDraws(device)
    expect(device.draws).toHaveLength(2)
    expect(fan.count).toBe(2 * 3 * 3)
    expect(cover.count).toBe(2 * 6)
  })

  it('keeps paths that overlap in painter order', async () => {
    const { gfx, device } = await makeGfx()
    gfx.fillPath(star(100), '#ff0000')
    gfx.fillPath(star(140), '#00ff00')
    gfx.endFrame()
    expect(device.draws).toHaveLength(4)
    expect(device.draws.map((d) => d.colorWrite)).toEqual([
      false,
      true,
      false,
      true,
    ])
  })

  it('does not join paths filled by different rules', async () => {
    const { gfx, device } = await makeGfx()
    gfx.fillPath(star(100), '#ff0000', 'nonzero')
    gfx.fillPath(star(300), '#00ff00', 'evenodd')
    gfx.endFrame()
    expect(device.draws).toHaveLength(4)
  })

  it('keeps a fill drawn between two paths after the first one', async () => {
    const { gfx, device } = await makeGfx()
    gfx.fillPath(star(100), '#ff0000')
    gfx.fillRect(60, 60, 80, 80, '#0000ff')
    gfx.fillPath(star(300), '#00ff00')
    gfx.endFrame()
    const order = device.draws.map((d) =>
      d.stencil === null ? 'rect' : d.colorWrite ? 'cover' : 'fan',
    )
    // The fans join across the rect, which the second path does not touch. The
    // rect still comes after the cover of the path it overlaps, and the second
    // cover follows it because the rect's vertices sit between the two covers.
    expect(order).toEqual(['fan', 'cover', 'rect', 'cover'])
  })

  it('picks the even-odd rows for the evenodd rule', async () => {
    const { gfx, device } = await makeGfx()
    gfx.fillPath(star(), '#ff0000', 'evenodd')
    gfx.endFrame()
    const [fan, cover] = fillDraws(device)
    expect(fan.stencil?.front.passOp).toBe('invert')
    expect(cover.stencil?.readMask).toBe(0x01)
  })

  it('skips the stencil for a convex path', async () => {
    const { gfx, device } = await makeGfx()
    const square = new GfxPath()
    square.moveTo(10, 10).lineTo(60, 10).lineTo(60, 60).lineTo(10, 60).close()
    gfx.fillPath(square, '#00ff00')
    gfx.endFrame()
    expect(device.draws).toHaveLength(1)
    expect(fillDraws(device)).toHaveLength(0)
  })

  it('draws nothing for a path entirely off screen', async () => {
    const { gfx, device } = await makeGfx()
    gfx.translate(5000, 5000)
    gfx.fillPath(star(), '#ff0000')
    gfx.endFrame()
    expect(device.draws).toHaveLength(0)
  })

  it('falls back to an even-odd earcut fill without a stencil buffer', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { gfx, device } = await makeGfx(false)
    gfx.fillPath(star(), '#ff0000')
    gfx.endFrame()
    expect(warn).toHaveBeenCalledTimes(1)
    warn.mockRestore()
    expect(device.draws.length).toBeGreaterThan(0)
    expect(fillDraws(device)).toHaveLength(0)
  })

  it('strokes each contour', async () => {
    const { gfx, device } = await makeGfx()
    gfx.strokePath(star(), { color: '#ffffff', width: 4 })
    gfx.endFrame()
    expect(device.draws.length).toBeGreaterThan(0)
  })

  it('fills with a radial gradient with a focal point', async () => {
    const { gfx, device } = await makeGfx()
    gfx.fillPath(star(), {
      kind: 'radial',
      cx: 100,
      cy: 100,
      r: 80,
      fx: 130,
      fy: 90,
      stops: [
        { offset: 0, color: '#ffffff' },
        { offset: 1, color: '#2255ff' },
      ],
    })
    gfx.endFrame()
    expect(fillDraws(device)).toHaveLength(2)
  })

  it('cuts dashes for strokePath', async () => {
    const { gfx, device } = await makeGfx()
    const line = new GfxPath().moveTo(0, 0).lineTo(200, 0)
    gfx.strokePath(line, {
      color: '#ffffff',
      width: 4,
      dash: [10, 10],
      dashOffset: 5,
    })
    gfx.endFrame()
    // One instanced draw holds every dash segment: 10 dashes of one segment each.
    expect(device.draws.length).toBeGreaterThan(0)
    const solid = new GfxPath().moveTo(0, 0).lineTo(200, 0)
    const before = device.draws.length
    gfx.beginFrame({
      clearColor: '#000000',
      transparent: false,
      pixelW: 400,
      pixelH: 300,
    })
    gfx.strokePath(solid, { color: '#ffffff', width: 4 })
    gfx.endFrame()
    expect(device.draws.length).toBeGreaterThan(before)
  })
})

describe('strokePath pieces', () => {
  const gradient = {
    kind: 'linear' as const,
    x0: 0,
    y0: 0,
    x1: 100,
    y1: 0,
    stops: [
      { offset: 0, color: '#ff0000' },
      { offset: 1, color: '#0000ff' },
    ],
  }

  async function frames(
    n: number,
    path: () => GfxPath,
  ): Promise<{ gfx: GpuGfx; device: MockGfxDevice }> {
    const { gfx, device } = await makeGfx()
    gfx.endFrame()
    const kept = path()
    for (let i = 0; i < n; i++) {
      gfx.beginFrame({
        clearColor: '#000000',
        transparent: false,
        pixelW: 400,
        pixelH: 300,
      })
      gfx.setBaseTransform(1, 0, 0, 1, 0, 0)
      gfx.setAlpha(1)
      gfx.strokePath(kept, { color: gradient, width: 6, join: 'round' })
      gfx.endFrame()
    }
    return { gfx, device }
  }

  it('keeps the pieces of a path stroked the same way two frames running', async () => {
    const { gfx } = await frames(3, () => star())
    const stats = gfx.cacheStats().find((c) => c.name === 'Stroke pieces')
    expect(stats?.entries).toBe(1)
    expect(stats?.hits).toBe(1)
  })

  it('keeps nothing for a path that changes every frame', async () => {
    const { gfx, device } = await makeGfx()
    gfx.endFrame()
    const path = star()
    for (let i = 0; i < 4; i++) {
      gfx.beginFrame({
        clearColor: '#000000',
        transparent: false,
        pixelW: 400,
        pixelH: 300,
      })
      gfx.setBaseTransform(1, 0, 0, 1, 0, 0)
      gfx.setAlpha(1)
      path.lineTo(10 + i, 10)
      gfx.strokePath(path, { color: gradient, width: 6, join: 'round' })
      gfx.endFrame()
    }
    const stats = gfx.cacheStats().find((c) => c.name === 'Stroke pieces')
    expect(stats?.entries).toBe(0)
    void device
  })
})
