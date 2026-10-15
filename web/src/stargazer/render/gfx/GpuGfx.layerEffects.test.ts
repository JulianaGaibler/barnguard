import { describe, expect, it } from 'vitest'
import { GpuGfx } from './GpuGfx'
import type { GfxSurfaceEffects } from './Gfx2D'
import type { ShaderReflection } from './GfxDevice'
import { MockGfxDevice } from './webgl2/mockGfxDevice'
import { postShader } from '../postfx/PostEffect'
import type { PostEffect, PostPass } from '../postfx/PostEffect'

const EMPTY_REFLECTION: ShaderReflection = {
  attributes: [],
  uniformBlocks: [],
  samplers: [],
}

function pass(): PostPass {
  return {
    shader: postShader('', '', '', EMPTY_REFLECTION),
    paramsBytes: 16,
    writeParams: (ctx, out) => {
      out[0] = ctx.width
    },
  }
}

function effect(passes = 1): PostEffect {
  return {
    enabled: true,
    passes: Array.from({ length: passes }, () => pass()),
  }
}

function smoothing(): PostEffect {
  return { ...effect(), smoothsInput: true }
}

function fx(effects: PostEffect[], owner: object = {}): GfxSurfaceEffects {
  return { owner, effects, dt: 0.016, applied: true }
}

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

/** Compile the effects' pipelines, which resolve over a few microtasks. */
async function warm(gfx: GpuGfx, ...all: GfxSurfaceEffects[]): Promise<void> {
  for (const e of all) gfx.warmEffects(e)
  for (let i = 0; i < 10; i++) await Promise.resolve()
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

const REGION = { x: 10, y: 20, width: 100, height: 50 }

/** Draw a layer's worth of content into an effects surface. */
function layer(gfx: GpuGfx, e: GfxSurfaceEffects, opts = {}): boolean {
  const opened = gfx.beginOffscreen({ bounds: REGION, effects: e, ...opts })
  gfx.fillRect(10, 20, 100, 50, '#ff0000')
  gfx.endOffscreen()
  return opened
}

/** The uploads of the test pass's 16-byte params block. */
function paramUploads(device: MockGfxDevice) {
  return device.uniformUploads.filter((u) => u.data.byteLength === 16)
}

/** Draws that are fullscreen effect passes: one triangle. */
function effectDraws(device: MockGfxDevice): number {
  return device.draws.filter((d) => d.kind === 'arrays' && d.count === 3).length
}

describe('surface effects', () => {
  it('runs the effects between the surface pass and the main pass', async () => {
    const { gfx, device } = await makeGfx()
    const e = fx([effect(2)])
    await warm(gfx, e)
    device.reset()
    begin(gfx)
    gfx.fillRect(0, 0, 4, 4, '#ffffff')
    layer(gfx, e)
    gfx.endFrame()

    // The surface, its two effect passes, then the main pass, and no more.
    expect(device.passes).toHaveLength(4)
    expect(e.applied).toBe(true)
    expect(effectDraws(device)).toBe(2)
    // The effect passes draw one fullscreen triangle each, so they sit between
    // the surface's red fill and the main pass's composite.
    expect(device.passes.map((p) => p.drawCount)).toEqual([1, 1, 1, 2])
  })

  it('composites the result of the effects, not the surface', async () => {
    const { gfx, device } = await makeGfx()
    const e = fx([effect()])
    await warm(gfx, e)
    device.reset()
    begin(gfx)
    layer(gfx, e)
    gfx.endFrame()
    const written = device.passes[1].desc.color!.target
    const composite = device.draws[device.draws.length - 1]
    expect(composite.texture).toBe(device.colorTexture(written))
  })

  it('allocates the surface at exactly the captured size', async () => {
    const { gfx, device } = await makeGfx(1)
    const e = fx([effect()])
    await warm(gfx, e)
    device.reset()
    begin(gfx)
    layer(gfx, e)
    gfx.endFrame()
    const target = device.passes[0].desc.color!.target
    expect(target.width).toBe(100)
    expect(target.height).toBe(50)
  })

  it('keeps the usual rounded surface when there are no effects', async () => {
    const { gfx, device } = await makeGfx(1)
    begin(gfx)
    gfx.beginOffscreen({ bounds: REGION })
    gfx.fillRect(10, 20, 100, 50, '#ff0000')
    gfx.endOffscreen()
    gfx.endFrame()
    const target = device.passes[0].desc.color!.target
    expect(target.width).toBe(128)
    expect(target.height).toBe(64)
  })

  it('composites the surface as it is while a pass is still compiling', async () => {
    const { gfx, device } = await makeGfx()
    const e = fx([effect()])
    begin(gfx)
    layer(gfx, e)
    gfx.endFrame()
    expect(e.applied).toBe(false)
    expect(device.passes).toHaveLength(2)
    expect(effectDraws(device)).toBe(0)

    await warm(gfx, e)
    device.reset()
    begin(gfx)
    layer(gfx, e)
    gfx.endFrame()
    expect(e.applied).toBe(true)
    expect(effectDraws(device)).toBe(1)
  })

  it('skips disabled effects and draws a plain surface when none are left', async () => {
    const { gfx, device } = await makeGfx()
    const off = effect()
    off.enabled = false
    const e = fx([off])
    begin(gfx)
    layer(gfx, e)
    gfx.endFrame()
    expect(e.applied).toBe(true)
    expect(device.passes).toHaveLength(2)
  })

  it('finishes an inner layer before the layer that contains it', async () => {
    const { gfx, device } = await makeGfx()
    const inner = fx([effect()])
    const outer = fx([effect(2)])
    await warm(gfx, inner, outer)
    device.reset()
    begin(gfx)
    gfx.beginOffscreen({ effects: outer })
    gfx.fillRect(0, 0, 10, 10, '#ff0000')
    layer(gfx, inner)
    gfx.endOffscreen()
    gfx.endFrame()
    // inner surface, inner pass, outer surface, outer passes, main.
    expect(device.passes.map((p) => p.drawCount)).toEqual([1, 1, 2, 1, 1, 1])
    expect(inner.applied && outer.applied).toBe(true)
  })

  it('writes separate params buffers for layers that share an effect', async () => {
    const { gfx, device } = await makeGfx()
    const shared = effect()
    const a = fx([shared])
    const b = fx([shared])
    await warm(gfx, a, b)
    device.reset()
    begin(gfx)
    layer(gfx, a)
    layer(gfx, b)
    gfx.endFrame()
    const uploads = paramUploads(device)
    expect(uploads).toHaveLength(2)
    expect(new Set(uploads.map((u) => u.buffer)).size).toBe(2)
  })

  it('sizes the effects to each layer', async () => {
    const { gfx, device } = await makeGfx()
    const shared = effect()
    const a = fx([shared])
    const b = fx([shared])
    await warm(gfx, a, b)
    device.reset()
    begin(gfx)
    layer(gfx, a)
    gfx.beginOffscreen({
      bounds: { x: 0, y: 0, width: 40, height: 40 },
      effects: b,
    })
    gfx.fillRect(0, 0, 40, 40, '#00ff00')
    gfx.endOffscreen()
    gfx.endFrame()
    const widths = paramUploads(device).map(
      (u) => new Float32Array(u.data.buffer)[0],
    )
    expect(widths).toEqual([100, 40])
  })

  it('clears the surface to the layer color, premultiplied', async () => {
    const { gfx, device } = await makeGfx(1)
    const e = fx([effect()])
    await warm(gfx, e)
    device.reset()
    begin(gfx)
    layer(gfx, e, { clearColor: 'rgba(255, 0, 0, 0.5)' })
    gfx.endFrame()
    const clear = device.passes[0].desc.color!.clearColor!
    expect(clear[3]).toBeCloseTo(0.5)
    expect(clear[0]).toBeCloseTo(0.5)
    expect(clear[1]).toBe(0)
  })

  it('draws a retained surface without effects', async () => {
    const { gfx } = await makeGfx()
    const e = fx([effect()])
    await warm(gfx, e)
    begin(gfx)
    gfx.beginOffscreen({ bounds: REGION, effects: e, retain: true })
    gfx.fillRect(10, 20, 100, 50, '#ff0000')
    const handle = gfx.endOffscreen()
    expect(handle).not.toBeNull()
    expect(e.applied).toBe(false)
    gfx.endFrame()
  })

  it('counts the effect passes in the frame stats', async () => {
    const { gfx } = await makeGfx()
    const e = fx([effect(3)])
    await warm(gfx, e)
    begin(gfx)
    layer(gfx, e)
    gfx.endFrame()
    // The surface, three effect passes and the main pass.
    expect(gfx.stats.passCount).toBe(5)
  })
})

describe('single-sample surfaces', () => {
  /** Let every pending pipeline compile. */
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

  /** Draw one frame with a layer and return its surface pass. */
  function frame(gfx: GpuGfx, device: MockGfxDevice, e: GfxSurfaceEffects) {
    device.reset()
    begin(gfx)
    layer(gfx, e)
    gfx.endFrame()
    return device.passes[0]
  }

  it('draws a layer whose first effect smooths without multisampling', async () => {
    const { gfx, device } = await makeGfx()
    const e = fx([smoothing()])
    await warm(gfx, e)
    // The first frame starts the single-sample pipelines and stays multisampled.
    expect(frame(gfx, device, e).desc.color!.target.samples).toBe(4)
    await settle()

    const surface = frame(gfx, device, e)
    expect(surface.desc.color!.target.samples).toBe(1)
    expect(surface.desc.color!.resolveTarget).toBeUndefined()
    const fill = device.draws[0]
    expect(fill.pipeline.desc.samples).toBe(1)
    // The composite draws into the main pass, which keeps its multisampling.
    const composite = device.draws[device.draws.length - 1]
    expect(composite.pipeline.desc.samples).toBe(4)
  })

  it('keeps multisampling when the first effect does not smooth', async () => {
    const { gfx, device } = await makeGfx()
    const e = fx([effect(), smoothing()])
    await warm(gfx, e)
    frame(gfx, device, e)
    await settle()
    const surface = frame(gfx, device, e)
    expect(surface.desc.color!.target.samples).toBe(4)
    expect(surface.desc.color!.resolveTarget).toBeDefined()
  })

  it('skips a disabled effect when it reads the first one', async () => {
    const { gfx, device } = await makeGfx()
    const e = fx([{ ...effect(), enabled: false }, smoothing()])
    await warm(gfx, e)
    frame(gfx, device, e)
    await settle()
    expect(frame(gfx, device, e).desc.color!.target.samples).toBe(1)
  })

  it('builds a single-sample pipeline for every multisampled one', async () => {
    const { gfx, device } = await makeGfx()
    const e = fx([smoothing()])
    await warm(gfx, e)
    frame(gfx, device, e)
    await settle()
    const key = (p: (typeof device.pipelines)[number]) =>
      [
        device.shaders.indexOf(p.desc.shader),
        p.desc.color?.blend ? JSON.stringify(p.desc.color.blend) : '',
        JSON.stringify(p.desc.stencil ?? null),
        p.desc.primitive,
      ].join('|')
    const single = new Set(
      device.pipelines.filter((p) => p.desc.samples === 1).map(key),
    )
    const multi = device.pipelines.filter((p) => p.desc.samples === 4)
    expect(multi.length).toBeGreaterThan(0)
    for (const p of multi) expect(single.has(key(p))).toBe(true)
  })
})
