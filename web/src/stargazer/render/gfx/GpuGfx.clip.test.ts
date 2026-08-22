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
