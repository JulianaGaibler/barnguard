import { describe, it, expect } from 'vitest'
import { GpuGfx } from './GpuGfx'
import { MockGfxDevice } from './webgl2/mockGfxDevice'
import type { DrawRecord } from './webgl2/mockGfxDevice'

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

  it('breaks the batch on a clip change, offsetting only the clipped run', async () => {
    const { gfx, device } = makeGpuGfx()
    await beginFrame(gfx, device)
    gfx.fillRect(0, 0, 10, 10, '#fff') // no clip
    gfx.setClip({ kind: 'circle', cx: 5, cy: 5, r: 20 })
    gfx.fillRect(20, 0, 10, 10, '#fff') // clipped
    gfx.setClip(null)
    gfx.fillRect(40, 0, 10, 10, '#fff') // no clip again
    gfx.endFrame()
    expect(device.draws.length).toBe(3)
    expect(clipOffset(device.draws[0]!)).toBe(0)
    expect(clipOffset(device.draws[1]!)).toBeGreaterThan(0)
    expect(clipOffset(device.draws[2]!)).toBe(0)
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
    expect(device.draws.length).toBe(3)
    // After restore the clip is gone, not leaked into the last run.
    expect(clipOffset(device.draws[2]!)).toBe(0)
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
    // 3.3 local units is 6.6 device px, which rounds to 7 → 3.5 local.
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
