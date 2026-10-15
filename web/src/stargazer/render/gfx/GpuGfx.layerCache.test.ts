import { describe, expect, it } from 'vitest'
import { GpuGfx } from './GpuGfx'
import type { GfxSurfaceCache, GfxSurfaceEffects } from './Gfx2D'
import type { ShaderReflection } from './GfxDevice'
import { MockGfxDevice } from './webgl2/mockGfxDevice'
import { postShader } from '../postfx/PostEffect'
import type { PostEffect, PostPass } from '../postfx/PostEffect'

const EMPTY_REFLECTION: ShaderReflection = {
  attributes: [],
  uniformBlocks: [],
  samplers: [],
}

/** An effect whose one pass writes the time, so animating it changes its params. */
function effect(animated = false): PostEffect {
  const pass: PostPass = {
    shader: postShader('', '', '', EMPTY_REFLECTION),
    paramsBytes: 16,
    writeParams: (ctx, out) => {
      out[0] = animated ? ctx.time : 1
    },
  }
  return { enabled: true, passes: [pass] }
}

/** Effects state for one cached layer, with a signature of the given values. */
function layer(
  effects: PostEffect[],
  ...signature: number[]
): GfxSurfaceEffects & { cache: GfxSurfaceCache } {
  return {
    owner: {},
    effects,
    dt: 0.016,
    applied: true,
    cache: {
      signature: Float64Array.from(signature),
      length: signature.length,
      invalidated: false,
      hit: false,
    },
  }
}

function sign(fx: GfxSurfaceEffects, ...signature: number[]): void {
  fx.cache!.signature = Float64Array.from(signature)
  fx.cache!.length = signature.length
}

async function makeGfx(samples = 1): Promise<{
  gfx: GpuGfx
  device: MockGfxDevice
}> {
  const canvas = document.createElement('canvas')
  canvas.width = 400
  canvas.height = 300
  const device = new MockGfxDevice()
  const gfx = new GpuGfx(canvas, device, { stencil: true, samples })
  await gfx.whenReady
  device.reset()
  return { gfx, device }
}

async function warm(gfx: GpuGfx, fx: GfxSurfaceEffects): Promise<void> {
  gfx.warmEffects(fx)
  for (let i = 0; i < 10; i++) await Promise.resolve()
}

const REGION = { x: 10, y: 20, width: 100, height: 50 }

/** One frame that draws the layer unless its kept render stands. */
function frame(gfx: GpuGfx, fx: GfxSurfaceEffects, region = REGION): boolean {
  gfx.beginFrame({
    clearColor: '#000000',
    transparent: false,
    pixelW: 400,
    pixelH: 300,
  })
  gfx.setBaseTransform(1, 0, 0, 1, 0, 0)
  gfx.setAlpha(1)
  gfx.beginOffscreen({ bounds: region, effects: fx })
  const kept = fx.cache!.hit
  if (!kept) gfx.fillRect(10, 20, 100, 50, '#ff0000')
  gfx.endOffscreen()
  gfx.endFrame()
  return kept
}

describe('cached layers', () => {
  it('renders the first frame and keeps the result', async () => {
    const { gfx, device } = await makeGfx()
    const fx = layer([effect()], 1, 2, 3)
    await warm(gfx, fx)
    device.reset()
    expect(frame(gfx, fx)).toBe(false)
    // The surface, the effect pass and the main pass.
    expect(device.passes).toHaveLength(3)
  })

  it('draws the kept result and nothing else while the signature holds', async () => {
    const { gfx, device } = await makeGfx()
    const fx = layer([effect()], 1, 2, 3)
    await warm(gfx, fx)
    frame(gfx, fx)
    const kept = device.passes[1].desc.color!.target
    device.reset()
    expect(frame(gfx, fx)).toBe(true)
    // Only the main pass runs, and it holds one draw, the composite.
    expect(device.passes).toHaveLength(1)
    expect(device.passes[0].drawCount).toBe(1)
    expect(device.draws[0].texture).toBe(device.colorTexture(kept))
    expect(fx.applied).toBe(true)
  })

  it('renders again when the signature changes, into the same target', async () => {
    const { gfx, device } = await makeGfx()
    const fx = layer([effect()], 1, 2, 3)
    await warm(gfx, fx)
    frame(gfx, fx)
    const first = device.passes[1].desc.color!.target
    const created = device.renderTargets.length
    device.reset()
    sign(fx, 1, 2, 4)
    expect(frame(gfx, fx)).toBe(false)
    expect(device.passes).toHaveLength(3)
    expect(device.passes[1].desc.color!.target).toBe(first)
    // Neither a new target for the render nor one freed.
    expect(device.renderTargets.length - created).toBeLessThanOrEqual(1)
    expect(device.deletedRenderTargets).toBe(0)
    // And the new signature is the one kept now.
    device.reset()
    expect(frame(gfx, fx)).toBe(true)
  })

  it('renders again when the layer is invalidated, once', async () => {
    const { gfx, device } = await makeGfx()
    const fx = layer([effect()], 1)
    await warm(gfx, fx)
    frame(gfx, fx)
    fx.cache.invalidated = true
    expect(frame(gfx, fx)).toBe(false)
    expect(fx.cache.invalidated).toBe(false)
    device.reset()
    expect(frame(gfx, fx)).toBe(true)
  })

  it('renders again when an effect animates its parameters', async () => {
    const { gfx } = await makeGfx()
    const fx = layer([effect(true)], 1)
    await warm(gfx, fx)
    expect(frame(gfx, fx)).toBe(false)
    // The effect writes the time, which moves every frame.
    expect(frame(gfx, fx)).toBe(false)
    expect(frame(gfx, fx)).toBe(false)
  })

  it('renders again when an effect is switched on or off', async () => {
    const { gfx } = await makeGfx()
    const a = effect()
    const b = effect()
    const fx = layer([a, b], 1)
    await warm(gfx, fx)
    frame(gfx, fx)
    expect(frame(gfx, fx)).toBe(true)
    b.enabled = false
    expect(frame(gfx, fx)).toBe(false)
    expect(frame(gfx, fx)).toBe(true)
  })

  it('renders again when the region changes size or place', async () => {
    const { gfx, device } = await makeGfx()
    const fx = layer([effect()], 1)
    await warm(gfx, fx)
    frame(gfx, fx)
    expect(frame(gfx, fx)).toBe(true)
    device.reset()
    const wider = { ...REGION, width: 120 }
    expect(frame(gfx, fx, wider)).toBe(false)
    // The old target is freed as the bigger one replaces it.
    expect(device.deletedRenderTargets).toBeGreaterThanOrEqual(1)
    expect(frame(gfx, fx, wider)).toBe(true)
    expect(frame(gfx, fx, { ...wider, x: 40 })).toBe(false)
  })

  it('keeps each layer apart', async () => {
    const { gfx } = await makeGfx()
    const a = layer([effect()], 1)
    const b = layer([effect()], 2)
    await warm(gfx, a)
    await warm(gfx, b)
    frame(gfx, a)
    frame(gfx, b)
    expect(frame(gfx, a)).toBe(true)
    expect(frame(gfx, b)).toBe(true)
    sign(a, 9)
    expect(frame(gfx, a)).toBe(false)
    expect(frame(gfx, b)).toBe(true)
  })

  it('does not keep a render made while an effect was still compiling', async () => {
    const { gfx } = await makeGfx()
    const fx = layer([effect()], 1)
    expect(frame(gfx, fx)).toBe(false)
    expect(fx.applied).toBe(false)
    expect(frame(gfx, fx)).toBe(false)
    await warm(gfx, fx)
    expect(frame(gfx, fx)).toBe(false)
    expect(fx.applied).toBe(true)
    expect(frame(gfx, fx)).toBe(true)
  })

  it('renders again after the context is restored', async () => {
    const { gfx, device } = await makeGfx()
    const fx = layer([effect()], 1)
    await warm(gfx, fx)
    frame(gfx, fx)
    expect(frame(gfx, fx)).toBe(true)
    device.simulateContextRestored()
    gfx.rebuildResources?.()
    await warm(gfx, fx)
    expect(frame(gfx, fx)).toBe(false)
    expect(frame(gfx, fx)).toBe(true)
  })

  it('reports the layers drawn from their kept render', async () => {
    const { gfx } = await makeGfx()
    const fx = layer([effect()], 1)
    await warm(gfx, fx)
    frame(gfx, fx)
    const stats = (): { entries: number; hits: number; bytes: number } =>
      gfx.cacheStats().find((s) => s.name === 'Layer renders')!
    expect(stats().entries).toBe(1)
    expect(stats().hits).toBe(0)
    frame(gfx, fx)
    expect(stats().hits).toBe(1)
    expect(stats().bytes).toBe(100 * 50 * 4)
  })
})
