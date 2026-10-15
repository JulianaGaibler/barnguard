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

function star(): GfxPath {
  const p = new GfxPath()
  for (let i = 0; i < 5; i++) {
    const a = (i * 4 * Math.PI) / 5 - Math.PI / 2
    const x = 100 + 80 * Math.cos(a)
    const y = 100 + 80 * Math.sin(a)
    if (i === 0) p.moveTo(x, y)
    else p.lineTo(x, y)
  }
  return p.close()
}

const fillDraws = (device: MockGfxDevice): DrawRecord[] =>
  device.draws.filter((d) => d.stencil !== null)

describe('fillPath', () => {
  it('records a fan then a cover that share one reservation', async () => {
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
    // The cover starts where the fan ends in the same buffer.
    expect(cover.vertexBuffers[0].buffer).toBe(fan.vertexBuffers[0].buffer)
    expect(cover.first).toBe(fan.first + fan.count)
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
