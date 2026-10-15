import { describe, it, expect } from 'vitest'
import { MockGfxDevice } from '../gfx/webgl2/mockGfxDevice'
import { RenderTargetPool } from '../gfx/RenderTargetPool'
import type { RenderTarget, ShaderReflection } from '../gfx/GfxDevice'
import { PostChain, type PostChainSource } from './PostChain'
import { PostProgramCache } from './PostProgramCache'
import { postShader } from './PostEffect'
import type { PostEffect, PostPass } from './PostEffect'
import { FilmGrain } from './effects/FilmGrain'
import { DualKawaseBlur } from './effects/DualKawaseBlur'

const EMPTY_REFLECTION: ShaderReflection = {
  attributes: [],
  uniformBlocks: [],
  samplers: [],
}

/** A pass that writes its params so a test can tell which chain ran it. */
function paramPass(): PostPass {
  return {
    shader: postShader('', '', '', EMPTY_REFLECTION),
    paramsBytes: 16,
    writeParams: (ctx, out) => {
      out[0] = ctx.width
      out[1] = ctx.time
    },
  }
}

class TestEffect implements PostEffect {
  enabled = true
  passes: PostPass[]
  constructor(passes: PostPass[]) {
    this.passes = passes
  }
}

function setup(device: MockGfxDevice) {
  const programs = new PostProgramCache(device)
  const pool = new RenderTargetPool(device)
  const chain = new PostChain(device, programs, pool)
  return { programs, pool, chain }
}

function makeSource(device: MockGfxDevice, w = 64, h = 32): PostChainSource {
  const rt = device.createRenderTarget({
    width: w,
    height: h,
    samples: 1,
    colorSpace: 'linear',
  })
  return { texture: device.colorTexture(rt), width: w, height: h }
}

/** Retry `prepare` across microtasks until its pipelines have compiled. */
async function prepared(
  chain: PostChain,
  effects: readonly PostEffect[],
): Promise<void> {
  for (let i = 0; i < 80; i++) {
    if (chain.prepare(effects, 'linear')) return
    await Promise.resolve()
  }
  throw new Error('pipelines never became ready')
}

describe('PostChain', () => {
  it('is not ready until the pass pipelines have compiled', async () => {
    const device = new MockGfxDevice()
    const { chain } = setup(device)
    const effects = [new TestEffect([paramPass()])]
    expect(chain.prepare(effects, 'linear')).toBe(false)
    await prepared(chain, effects)
    expect(chain.prepare(effects, 'linear')).toBe(true)
  })

  it('gives two chains running one effect separate params buffers', async () => {
    const device = new MockGfxDevice()
    const programs = new PostProgramCache(device)
    const pool = new RenderTargetPool(device)
    const a = new PostChain(device, programs, pool)
    const b = new PostChain(device, programs, pool)
    const effects = [new TestEffect([paramPass()])]
    await prepared(a, effects)
    await prepared(b, effects)
    a.advance(0.1)
    b.advance(0.5)
    a.release(a.run(makeSource(device, 64), effects, 'linear', null)!)
    b.release(b.run(makeSource(device, 32), effects, 'linear', null)!)

    const uploads = device.uniformUploads
    expect(uploads).toHaveLength(2)
    expect(uploads[0].buffer).not.toBe(uploads[1].buffer)
    const first = new Float32Array(uploads[0].data.buffer)
    const second = new Float32Array(uploads[1].data.buffer)
    expect([first[0], first[1]]).toEqual([64, expect.closeTo(0.1, 5)])
    expect([second[0], second[1]]).toEqual([32, expect.closeTo(0.5, 5)])
  })

  it('compiles a pass once across chains that share a program cache', async () => {
    const device = new MockGfxDevice()
    const programs = new PostProgramCache(device)
    const pool = new RenderTargetPool(device)
    const a = new PostChain(device, programs, pool)
    const b = new PostChain(device, programs, pool)
    const effects = [new TestEffect([paramPass()])]
    await prepared(a, effects)
    await prepared(b, effects)
    expect(device.programs).toHaveLength(1)
  })

  it('draws the last pass into dest and returns it', async () => {
    const device = new MockGfxDevice()
    const { chain } = setup(device)
    const effects = [new TestEffect([paramPass(), paramPass()])]
    await prepared(chain, effects)
    const dest: RenderTarget = device.createRenderTarget({
      width: 64,
      height: 32,
      samples: 1,
      colorSpace: 'linear',
    })
    device.reset()
    const result = chain.run(makeSource(device), effects, 'linear', dest)
    expect(result).toBe(dest)
    expect(device.passes).toHaveLength(2)
    expect(device.passes[1].desc.color?.target).toBe(dest)
    expect(device.passes[0].desc.color?.target).not.toBe(dest)
  })

  it('returns a pooled target when there is no dest, and null with nothing enabled', async () => {
    const device = new MockGfxDevice()
    const { chain } = setup(device)
    const effect = new TestEffect([paramPass()])
    await prepared(chain, [effect])
    const out = chain.run(makeSource(device), [effect], 'linear', null)
    expect(out).not.toBeNull()
    chain.release(out!)
    effect.enabled = false
    expect(chain.run(makeSource(device), [effect], 'linear', null)).toBeNull()
  })
})

describe('PostChain.paramsChanged', () => {
  const SRC = { width: 64, height: 32 }

  it('reports the first call, then nothing while the params hold', () => {
    const { chain } = setup(new MockGfxDevice())
    const effects = [new FilmGrain({ hz: 0 })]
    expect(chain.paramsChanged(SRC, effects)).toBe(true)
    chain.advance(0.016)
    expect(chain.paramsChanged(SRC, effects)).toBe(false)
    chain.advance(5)
    expect(chain.paramsChanged(SRC, effects)).toBe(false)
  })

  it('reports grain with a frame rate only when its frame index moves', () => {
    const { chain } = setup(new MockGfxDevice())
    const effects = [new FilmGrain({ hz: 10 })]
    chain.paramsChanged(SRC, effects)
    chain.advance(0.04)
    expect(chain.paramsChanged(SRC, effects)).toBe(false)
    chain.advance(0.07)
    expect(chain.paramsChanged(SRC, effects)).toBe(true)
  })

  it('reports an edited parameter', () => {
    const { chain } = setup(new MockGfxDevice())
    const grain = new FilmGrain({ hz: 0 })
    const effects = [grain]
    chain.paramsChanged(SRC, effects)
    grain.opacity = 0.5
    expect(chain.paramsChanged(SRC, effects)).toBe(true)
    expect(chain.paramsChanged(SRC, effects)).toBe(false)
  })

  it('reports a swapped pass list', () => {
    const { chain } = setup(new MockGfxDevice())
    const blur = new DualKawaseBlur({ levels: 2 })
    const effects = [blur]
    chain.paramsChanged(SRC, effects)
    expect(chain.paramsChanged(SRC, effects)).toBe(false)
    blur.levels = 3
    expect(chain.paramsChanged(SRC, effects)).toBe(true)
  })

  it('ignores a source size the params do not use, and reports the enabled set', () => {
    const { chain } = setup(new MockGfxDevice())
    const grain = new FilmGrain({ hz: 0 })
    chain.paramsChanged(SRC, [grain])
    expect(chain.paramsChanged({ width: 128, height: 32 }, [grain])).toBe(false)
    const blur = new DualKawaseBlur({ levels: 1 })
    expect(chain.paramsChanged(SRC, [grain, blur])).toBe(true)
    blur.enabled = false
    expect(chain.paramsChanged(SRC, [grain, blur])).toBe(true)
  })
})
