import { describe, expect, it } from 'vitest'
import { GpuGfx } from './GpuGfx'
import { MockGfxDevice } from './webgl2/mockGfxDevice'
import { ParamTable, clipDistance } from './ParamTable'

async function frame(): Promise<{ gfx: GpuGfx; device: MockGfxDevice }> {
  const canvas = document.createElement('canvas')
  canvas.width = 400
  canvas.height = 300
  const device = new MockGfxDevice()
  const gfx = new GpuGfx(canvas, device)
  await gfx.whenReady
  device.reset()
  gfx.beginFrame({
    clearColor: '#000',
    transparent: false,
    pixelW: 400,
    pixelH: 300,
  })
  gfx.setBaseTransform(1, 0, 0, 1, 0, 0)
  gfx.setAlpha(1)
  return { gfx, device }
}

/** The clip record the frame wrote for its first clip, after the empty one. */
function firstClipRecord(device: MockGfxDevice): Float32Array {
  return device.dataTableUploads.at(-1)!.data.slice(16, 32)
}

describe('clip records', () => {
  it('measure a rounded rect clip under a quarter turn in local space', async () => {
    const { gfx, device } = await frame()
    gfx.translate(100, 100)
    gfx.rotate(Math.PI / 2)
    gfx.setClip({ kind: 'roundRect', x: -20, y: -5, w: 40, h: 10, radius: 3 })
    gfx.fillRect(-30, -30, 60, 60, '#fff')
    gfx.endFrame()
    const rec = firstClipRecord(device)
    // The 40 by 10 box turned a quarter is 10 wide and 40 tall on the device.
    expect(clipDistance(rec, 100, 115)).toBeLessThan(0)
    expect(clipDistance(rec, 100, 85)).toBeLessThan(0)
    expect(clipDistance(rec, 115, 100)).toBeGreaterThan(0)
    expect(clipDistance(rec, 85, 100)).toBeGreaterThan(0)
    expect(clipDistance(rec, 100, 130)).toBeGreaterThan(0)
  })

  it('make a circle clip under a non-uniform scale an ellipse', async () => {
    const { gfx, device } = await frame()
    gfx.translate(100, 100)
    gfx.scale(2, 1)
    gfx.setClip({ kind: 'circle', cx: 0, cy: 0, r: 10 })
    gfx.fillRect(-30, -30, 60, 60, '#fff')
    gfx.endFrame()
    const rec = firstClipRecord(device)
    // 20 wide either side of the centre, 10 tall.
    expect(clipDistance(rec, 115, 100)).toBeLessThan(0)
    expect(clipDistance(rec, 100, 115)).toBeGreaterThan(0)
    expect(clipDistance(rec, 125, 100)).toBeGreaterThan(0)
  })

  it('keep a circle clip a circle under uniform scale and a shift', async () => {
    const { gfx, device } = await frame()
    gfx.translate(50, 60)
    gfx.scale(3, 3)
    gfx.setClip({ kind: 'circle', cx: 1, cy: 1, r: 5 })
    gfx.fillRect(0, 0, 10, 10, '#fff')
    gfx.endFrame()
    const rec = firstClipRecord(device)
    // Centre at device (53, 63), radius 15.
    expect(clipDistance(rec, 53, 63 + 14)).toBeLessThan(0)
    expect(clipDistance(rec, 53, 63 + 16)).toBeGreaterThan(0)
  })

  it('give each corner of a rounded rect clip its own radius', async () => {
    const { gfx, device } = await frame()
    // Square top left corner, a 30 radius bottom right one.
    gfx.setClip({
      kind: 'roundRect',
      x: 100,
      y: 100,
      w: 80,
      h: 80,
      radii: [0, 10, 30, 10],
    })
    gfx.fillRect(0, 0, 400, 300, '#fff')
    gfx.endFrame()
    const rec = firstClipRecord(device)
    // Just inside each corner point: kept where the corner is square, cut
    // where it is rounded.
    expect(clipDistance(rec, 101, 101)).toBeLessThan(0)
    expect(clipDistance(rec, 179, 101)).toBeGreaterThan(0)
    expect(clipDistance(rec, 175, 175)).toBeGreaterThan(0)
    // The bottom right arc is centered at (150, 150) with radius 30.
    expect(clipDistance(rec, 150 + 21, 150 + 21)).toBeLessThan(0)
    expect(clipDistance(rec, 150 + 22, 150 + 22)).toBeGreaterThan(0)
  })

  it('treat a record of kind 0 as no clip', () => {
    expect(clipDistance(new Float32Array(16), 5, 5)).toBe(-Infinity)
  })
})

describe('ParamTable', () => {
  it('starts every frame with only the empty record, and grows past its first size', () => {
    const table = new ParamTable()
    const make = (r: number): Parameters<ParamTable['clipIndex']>[0] => ({
      kind: 1,
      cx: 0,
      cy: 0,
      r,
      halfW: 0,
      halfH: 0,
      radii: [0, 0, 0, 0],
      lcx: 0,
      lcy: 0,
      lr: r,
      lhalfW: 0,
      lhalfH: 0,
      lradii: [0, 0, 0, 0],
      ia: 1,
      ib: 0,
      ic: 0,
      id: 1,
      ie: 0,
      if: 0,
    })
    expect(table.count).toBe(1)
    for (let i = 1; i <= 600; i++) expect(table.clipIndex(make(i))).toBe(i)
    expect(table.record(600)[3]).toBe(600)
    table.reset()
    expect(table.count).toBe(1)
    expect(table.clipIndex(null)).toBe(0)
  })
})
