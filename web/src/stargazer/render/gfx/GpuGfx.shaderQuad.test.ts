import { describe, expect, it } from 'vitest'
import { GpuGfx } from './GpuGfx'
import { MockGfxDevice } from './webgl2/mockGfxDevice'
import { DataTexture, ShaderQuad, quadShader } from './ShaderQuad'

function makeGpuGfx(): { gfx: GpuGfx; device: MockGfxDevice } {
  const canvas = document.createElement('canvas')
  canvas.width = 400
  canvas.height = 300
  const device = new MockGfxDevice()
  return { gfx: new GpuGfx(canvas, device), device }
}

async function frame(gfx: GpuGfx, device: MockGfxDevice): Promise<void> {
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
}

/** Lets the quad's async pipeline compile settle. */
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

const SHADER = quadShader('vert', 'frag', 'wgsl', {
  attributes: [],
  uniformBlocks: [],
  samplers: [],
})

function makeQuad(textures: DataTexture[] = []): ShaderQuad {
  return new ShaderQuad({ shader: SHADER, paramsBytes: 32, textures })
}

/** A frame that draws once to start the compile, then one that can draw. */
async function primed(
  gfx: GpuGfx,
  device: MockGfxDevice,
  quad: ShaderQuad,
): Promise<void> {
  await frame(gfx, device)
  gfx.drawShaderQuad(quad, 0, 0, 10, 10)
  gfx.endFrame()
  await settle()
}

describe('GpuGfx.drawShaderQuad', () => {
  it('draws nothing until the quad pipeline has compiled', async () => {
    const { gfx, device } = makeGpuGfx()
    const quad = makeQuad()
    await frame(gfx, device)
    gfx.drawShaderQuad(quad, 0, 0, 10, 10)
    gfx.endFrame()
    expect(device.draws.length).toBe(0)

    await settle()
    await frame(gfx, device)
    gfx.drawShaderQuad(quad, 0, 0, 10, 10)
    gfx.endFrame()
    expect(device.draws.length).toBe(1)
  })

  it('gives each draw of one quad its own params slice', async () => {
    const { gfx, device } = makeGpuGfx()
    const quad = makeQuad()
    await primed(gfx, device, quad)

    await frame(gfx, device)
    quad.params[0] = 1
    gfx.drawShaderQuad(quad, 0, 0, 10, 10)
    quad.params[0] = 2
    gfx.drawShaderQuad(quad, 20, 0, 10, 10)
    gfx.endFrame()

    expect(device.draws.length).toBe(2)
    const offsets = device.draws.map(
      (d) => d.bindGroups?.find((g) => g.group === 1)?.dynamicOffsets?.[0],
    )
    expect(offsets[0]).toBeDefined()
    expect(offsets[1]).toBeDefined()
    expect(offsets[0]).not.toBe(offsets[1])
  })

  it('keeps painter order against the streamed programs', async () => {
    const { gfx, device } = makeGpuGfx()
    const quad = makeQuad()
    await primed(gfx, device, quad)

    await frame(gfx, device)
    gfx.fillRect(0, 0, 5, 5, '#ff0000')
    gfx.drawShaderQuad(quad, 0, 0, 10, 10)
    gfx.fillRect(10, 0, 5, 5, '#00ff00')
    gfx.endFrame()

    const programs = device.draws.map((d) => d.program)
    expect(programs.length).toBe(3)
    expect(programs[0]).toBe(programs[2])
    expect(programs[1]).not.toBe(programs[0])
  })

  it('uploads a data texture once per version', async () => {
    const { gfx, device } = makeGpuGfx()
    const cells = new DataTexture(4, 3)
    const quad = makeQuad([cells])
    await primed(gfx, device, quad)

    const drawTwice = async () => {
      await frame(gfx, device)
      gfx.drawShaderQuad(quad, 0, 0, 10, 10)
      gfx.drawShaderQuad(quad, 20, 0, 10, 10)
      gfx.endFrame()
    }

    await drawTwice()
    expect(device.textureUploads.length).toBe(1)
    expect(device.textureUploads[0].size).toEqual({ w: 4, h: 3 })

    await drawTwice()
    expect(device.textureUploads.length).toBe(0)

    cells.data[0] = 200
    cells.markDirty()
    await drawTwice()
    expect(device.textureUploads.length).toBe(1)
  })

  it('selects the additive pipeline under the lighter blend', async () => {
    const { gfx, device } = makeGpuGfx()
    const quad = makeQuad()
    await primed(gfx, device, quad)

    await frame(gfx, device)
    gfx.setBlend('lighter')
    gfx.drawShaderQuad(quad, 0, 0, 10, 10)
    gfx.endFrame()
    // The first draw of a new blend only starts its compile.
    expect(device.draws.length).toBe(0)

    await settle()
    await frame(gfx, device)
    gfx.setBlend('lighter')
    gfx.drawShaderQuad(quad, 0, 0, 10, 10)
    gfx.endFrame()
    expect(device.draws.length).toBe(1)
    expect(device.draws[0].blend).toBe('lighter')
  })

  it('rejects a params block or texture list over the limit', () => {
    expect(
      () => new ShaderQuad({ shader: SHADER, paramsBytes: 4096 }),
    ).toThrow()
    const tex = new DataTexture(1, 1)
    expect(
      () =>
        new ShaderQuad({ shader: SHADER, textures: [tex, tex, tex, tex, tex] }),
    ).toThrow()
  })
})
