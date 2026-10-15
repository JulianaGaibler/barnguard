import { describe, it, expect } from 'vitest'
import { GpuGfx } from './GpuGfx'
import { GfxPath } from './GfxPath'
import { MockGfxDevice } from './webgl2/mockGfxDevice'
import type { DrawRecord } from './webgl2/mockGfxDevice'

function makeGpuGfx(stencil = false): { gfx: GpuGfx; device: MockGfxDevice } {
  const canvas = document.createElement('canvas')
  canvas.width = 400
  canvas.height = 300
  const device = new MockGfxDevice()
  const gfx = new GpuGfx(canvas, device, { stencil })
  return { gfx, device }
}

async function beginFrame(gfx: GpuGfx, device: MockGfxDevice): Promise<void> {
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
}

/** The clip dynamic offset a draw binds through the group-0 frame group. */
const clipOffset = (d: DrawRecord): number =>
  d.bindGroups.find((g) => g.group === 0)?.dynamicOffsets?.[0] ?? -1

/** The param record index of each vertex of a colored-tri draw, in order. */
function vertexRecords(d: DrawRecord): number[] {
  const words = new Uint32Array(d.bufferSnapshot as ArrayBuffer)
  const out: number[] = []
  for (let w = 5; w < words.length; w += 6) out.push(words[w])
  return out
}

describe('GpuGfx analytic clip', () => {
  it('keeps an unchanged clip in one batch, at the no-clip offset', async () => {
    const { gfx, device } = makeGpuGfx()
    await beginFrame(gfx, device)
    gfx.fillRect(0, 0, 10, 10, '#fff')
    gfx.fillRect(20, 0, 10, 10, '#fff')
    gfx.endFrame()
    expect(device.draws.length).toBe(1)
    expect(clipOffset(device.draws[0]!)).toBe(0)
  })

  it('draws clipped and unclipped fills in one draw, each naming its record', async () => {
    const { gfx, device } = makeGpuGfx()
    await beginFrame(gfx, device)
    gfx.fillRect(0, 0, 10, 10, '#fff') // no clip
    gfx.setClip({ kind: 'circle', cx: 5, cy: 5, r: 20 })
    gfx.fillRect(20, 0, 10, 10, '#fff') // clipped
    gfx.setClip(null)
    gfx.fillRect(40, 0, 10, 10, '#fff') // no clip again
    gfx.endFrame()
    expect(device.draws.length).toBe(1)
    // The streamed program reads its clip from the table, not the clip ring.
    expect(clipOffset(device.draws[0]!)).toBe(0)
    const rec = vertexRecords(device.draws[0]!)
    expect(rec).toEqual([
      ...Array(6).fill(0),
      ...Array(6).fill(1),
      ...Array(6).fill(0),
    ])
  })

  it('scopes the clip to save/restore', async () => {
    const { gfx, device } = makeGpuGfx()
    await beginFrame(gfx, device)
    gfx.fillRect(0, 0, 10, 10, '#fff')
    gfx.save()
    gfx.setClip({ kind: 'circle', cx: 5, cy: 5, r: 20 })
    gfx.fillRect(20, 0, 10, 10, '#fff')
    gfx.restore()
    gfx.fillRect(40, 0, 10, 10, '#fff')
    gfx.endFrame()
    // After restore the clip is gone, not leaked into the last fill.
    const rec = vertexRecords(device.draws[0]!)
    expect(rec.slice(12)).toEqual(Array(6).fill(0))
    expect(rec.slice(6, 12)).toEqual(Array(6).fill(1))
  })

  it('writes the same record once for a clip set again unchanged', async () => {
    const { gfx, device } = makeGpuGfx()
    await beginFrame(gfx, device)
    const clip = { kind: 'circle', cx: 5, cy: 5, r: 20 } as const
    gfx.setClip(clip)
    gfx.fillRect(0, 0, 10, 10, '#fff')
    gfx.setClip(clip)
    gfx.fillRect(20, 0, 10, 10, '#fff')
    gfx.endFrame()
    const rec = vertexRecords(device.draws[0]!)
    expect(new Set(rec).size).toBe(1)
  })
})

describe('GpuGfx analytic clip with stencil paths', () => {
  it('stamps the current clip record on the fan and cover vertices', async () => {
    const { gfx, device } = makeGpuGfx(true)
    await beginFrame(gfx, device)
    const star = new GfxPath()
    for (let i = 0; i < 5; i++) {
      const a = (i * 4 * Math.PI) / 5 - Math.PI / 2
      const x = 100 + 80 * Math.cos(a)
      const y = 100 + 80 * Math.sin(a)
      if (i === 0) star.moveTo(x, y)
      else star.lineTo(x, y)
    }
    star.close()
    gfx.setClip({ kind: 'circle', cx: 100, cy: 100, r: 60 })
    gfx.fillRect(0, 0, 10, 10, '#fff')
    gfx.setClip(null)
    gfx.fillPath(star, '#ff0000')
    gfx.endFrame()
    const fan = device.draws.find((d) => d.stencil !== null)!
    const rec = vertexRecords(fan).slice(fan.first, fan.first + fan.count + 6)
    expect(rec.length).toBeGreaterThan(0)
    expect(new Set(rec)).toEqual(new Set([0]))
  })
})

describe('GpuGfx device pixel grid', () => {
  it('reports the current transform scale, folding in nested scales', async () => {
    const { gfx, device } = makeGpuGfx()
    await beginFrame(gfx, device)
    expect(gfx.deviceScale()).toBeCloseTo(1)
    gfx.save()
    gfx.scale(2, 2)
    expect(gfx.deviceScale()).toBeCloseTo(2)
    gfx.scale(1.5, 1.5)
    expect(gfx.deviceScale()).toBeCloseTo(3)
    gfx.restore()
    expect(gfx.deviceScale()).toBeCloseTo(1)
    gfx.endFrame()
  })

  it('is unchanged by rotation, which moves no pixels closer together', async () => {
    const { gfx, device } = makeGpuGfx()
    await beginFrame(gfx, device)
    gfx.scale(2, 2)
    gfx.rotate(Math.PI / 5)
    expect(gfx.deviceScale()).toBeCloseTo(2)
    gfx.endFrame()
  })

  it('snaps a size to whole device pixels', async () => {
    const { gfx, device } = makeGpuGfx()
    await beginFrame(gfx, device)
    gfx.scale(2, 2)
    // 3.3 local units is 6.6 device px, which rounds to 7 -> 3.5 local.
    expect(gfx.snapSize(3.3)).toBeCloseTo(3.5)
    expect(gfx.snapSize(4)).toBeCloseTo(4)
    gfx.endFrame()
  })

  it('never snaps a size below one device pixel', async () => {
    const { gfx, device } = makeGpuGfx()
    await beginFrame(gfx, device)
    gfx.scale(4, 4)
    expect(gfx.snapSize(0.01)).toBeCloseTo(0.25)
    gfx.endFrame()
  })

  it('leaves a non-finite size alone', async () => {
    const { gfx, device } = makeGpuGfx()
    await beginFrame(gfx, device)
    expect(gfx.snapSize(Number.NaN)).toBeNaN()
    gfx.endFrame()
  })
})
