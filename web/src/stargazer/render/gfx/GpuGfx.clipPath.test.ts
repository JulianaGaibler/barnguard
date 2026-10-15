import { describe, expect, it, vi } from 'vitest'
import { GpuGfx } from './GpuGfx'
import { GfxPath } from './GfxPath'
import { MockGfxDevice } from './webgl2/mockGfxDevice'

async function makeGfx(): Promise<{ gfx: GpuGfx; device: MockGfxDevice }> {
  const canvas = document.createElement('canvas')
  canvas.width = 400
  canvas.height = 300
  const device = new MockGfxDevice()
  const gfx = new GpuGfx(canvas, device, { stencil: true })
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

describe('clipPath', () => {
  it('raises the clip, tests inside it, and lowers it on restore', async () => {
    const { gfx, device } = await makeGfx()
    gfx.fillRect(0, 0, 4, 4, '#ffffff')
    gfx.save()
    gfx.clipPath(star())
    gfx.fillRect(0, 0, 300, 300, '#ff0000')
    gfx.restore()
    gfx.fillRect(0, 0, 4, 4, '#00ff00')
    gfx.endFrame()
    const d = device.draws
    // before, fan, apply, inside, pop, after
    expect(d).toHaveLength(6)
    expect(d[0].stencil).toBeNull()
    expect(d[1].stencil?.front.passOp).toBe('increment-wrap')
    expect(d[1].stencilReference).toBe(0)
    expect(d[2].stencil?.front.passOp).toBe('replace')
    expect(d[2].colorWrite).toBe(false)
    expect(d[2].stencilReference).toBe(0x20)
    // The draw inside tests depth 1 and writes nothing.
    expect(d[3].stencil?.front.compare).toBe('equal')
    expect(d[3].stencil?.writeMask).toBe(0)
    expect(d[3].stencilReference).toBe(0x20)
    expect(d[4].stencil?.front.compare).toBe('less')
    expect(d[4].stencilReference).toBe(0x1f)
    expect(d[5].stencil).toBeNull()
  })

  it('nests, and fans test the depth they run at', async () => {
    const { gfx, device } = await makeGfx()
    gfx.save()
    gfx.clipPath(star())
    gfx.save()
    gfx.clipPath(star())
    gfx.fillRect(0, 0, 10, 10, '#ffffff')
    gfx.restore()
    gfx.restore()
    gfx.endFrame()
    const refs = device.draws.map((d) => d.stencilReference)
    // fan0 apply0 fan1 apply1 inside pop1 pop0
    expect(refs).toEqual([0, 0x20, 0x20, 0x40, 0x40, 0x3f, 0x1f])
  })

  it('refuses to nest past 7 and stays balanced', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { gfx, device } = await makeGfx()
    for (let i = 0; i < 9; i++) {
      gfx.save()
      gfx.clipPath(star())
    }
    gfx.fillRect(0, 0, 10, 10, '#ffffff')
    for (let i = 0; i < 9; i++) gfx.restore()
    gfx.fillRect(0, 0, 10, 10, '#ffffff')
    gfx.endFrame()
    expect(warn).toHaveBeenCalledTimes(1)
    warn.mockRestore()
    const last = device.draws[device.draws.length - 1]
    expect(last.stencil).toBeNull()
    // The draw inside ran at the deepest allowed level.
    const inside = device.draws.find(
      (d) => d.stencil?.front.compare === 'equal' && d.stencil?.writeMask === 0,
    )
    expect(inside?.stencilReference).toBe(7 << 5)
  })

  it('clips everything away for an off-screen path', async () => {
    const { gfx, device } = await makeGfx()
    gfx.save()
    gfx.translate(5000, 5000)
    gfx.clipPath(star())
    gfx.translate(-5000, -5000)
    gfx.fillRect(0, 0, 10, 10, '#ffffff')
    gfx.restore()
    gfx.endFrame()
    // No fan or apply, and the fill tests a depth no pixel holds.
    expect(device.draws).toHaveLength(1)
    expect(device.draws[0].stencilReference).toBe(0x20)
  })
})
