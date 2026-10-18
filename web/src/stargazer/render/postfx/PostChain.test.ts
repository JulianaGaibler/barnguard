import { describe, it, expect, vi } from 'vitest'
import { MockGfxDevice } from '../gfx/webgl2/mockGfxDevice'
import { RenderTargetPool } from '../gfx/RenderTargetPool'
import type { RenderTarget, ShaderReflection } from '../gfx/GfxDevice'
import { PostChain, type PostChainSource } from './PostChain'
import { PostProgramCache } from './PostProgramCache'
import { postShader } from './PostEffect'
import { DataTexture } from '../gfx/ShaderQuad'
import type { Texture } from '../gfx/GfxDevice'
import type { PostDataPass, PostEffect, PostPass, PostStep } from './PostEffect'
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
  passes: PostStep[]
  constructor(passes: PostStep[]) {
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

/** The texture bound at `binding` in draw `index`'s bind group. */
function boundTexture(
  device: MockGfxDevice,
  index: number,
  binding: number,
): Texture | undefined {
  const group = device.draws[index].bindGroups[0].bindGroup as unknown as {
    entries: Array<{ binding: number; resource: { texture?: Texture } }>
  }
  return group.entries.find((e) => e.binding === binding)?.resource.texture
}

function plainPass(extra: Partial<PostPass> = {}): PostPass {
  return {
    shader: postShader('', '', '', EMPTY_REFLECTION),
    paramsBytes: 0,
    ...extra,
  }
}

describe('PostChain placement, sizes and inputs', () => {
  it('hands the source placement to every pass', async () => {
    const device = new MockGfxDevice()
    const { chain } = setup(device)
    const seen: number[][] = []
    const pass = plainPass({
      paramsBytes: 16,
      writeParams: (ctx) => {
        const s = ctx.source
        seen.push([
          s.width,
          s.height,
          s.originX,
          s.originY,
          s.pxPerUnit,
          s.unitOriginX,
          s.unitOriginY,
        ])
      },
    })
    const effects = [new TestEffect([pass])]
    await prepared(chain, effects)
    const src = makeSource(device, 64, 32)
    src.placement = {
      originX: 10,
      originY: 20,
      pxPerUnit: 2,
      unitOriginX: -5,
      unitOriginY: 7,
    }
    chain.release(chain.run(src, effects, 'linear', null)!)
    expect(seen.at(-1)).toEqual([64, 32, 10, 20, 2, -5, 7])
  })

  it('reads the placement in paramsChanged too', () => {
    const { chain } = setup(new MockGfxDevice())
    const pass = plainPass({
      paramsBytes: 16,
      writeParams: (ctx, out) => {
        out[0] = ctx.source.unitOriginX
      },
    })
    const effects = [new TestEffect([pass])]
    const base = { originX: 0, originY: 0, pxPerUnit: 1, unitOriginY: 0 }
    chain.paramsChanged(
      { width: 8, height: 8, placement: { ...base, unitOriginX: 1 } },
      effects,
    )
    expect(
      chain.paramsChanged(
        { width: 8, height: 8, placement: { ...base, unitOriginX: 1 } },
        effects,
      ),
    ).toBe(false)
    expect(
      chain.paramsChanged(
        { width: 8, height: 8, placement: { ...base, unitOriginX: 2 } },
        effects,
      ),
    ).toBe(true)
  })

  it('sizes a pass from size() ahead of scale, at least one pixel', async () => {
    const device = new MockGfxDevice()
    const { chain } = setup(device)
    const widths: number[] = []
    const sized = plainPass({
      paramsBytes: 16,
      scale: 0.5,
      size: (source) => ({ width: source.width / 8, height: 0 }),
      writeParams: (ctx) => widths.push(ctx.width, ctx.height),
    })
    const effects = [new TestEffect([sized])]
    await prepared(chain, effects)
    chain.release(
      chain.run(makeSource(device, 64, 32), effects, 'linear', null)!,
    )
    expect(widths.slice(-2)).toEqual([8, 1])
  })

  it('reads the source or a named earlier pass when asked', async () => {
    const device = new MockGfxDevice()
    const { chain } = setup(device)
    const first = plainPass()
    const second = plainPass()
    const fromSource = plainPass({ input: 'source' })
    const fromFirst = plainPass({ input: first })
    const effects = [new TestEffect([first, second, fromSource, fromFirst])]
    await prepared(chain, effects)
    const src = makeSource(device)
    chain.release(chain.run(src, effects, 'linear', null)!)
    const outputs = device.draws.map((_, i) => boundTexture(device, i, 0))
    expect(outputs[0]).toBe(src.texture)
    expect(outputs[1]).not.toBe(src.texture)
    expect(outputs[2]).toBe(src.texture)
    // Both read the first pass's output.
    expect(outputs[3]).toBe(outputs[1])
    expect(outputs[3]).not.toBe(src.texture)
  })

  it('binds extra textures after u_tex, uploading a data texture once per version', async () => {
    const device = new MockGfxDevice()
    const { chain } = setup(device)
    const data = new DataTexture(4, 4)
    const first = plainPass()
    const second = plainPass({ textures: [data, first, 'source'] })
    const effects = [new TestEffect([first, second])]
    await prepared(chain, effects)
    const src = makeSource(device)
    chain.release(chain.run(src, effects, 'linear', null)!)
    chain.release(chain.run(src, effects, 'linear', null)!)
    expect(device.dataUploads).toHaveLength(1)
    data.markDirty()
    chain.release(chain.run(src, effects, 'linear', null)!)
    expect(device.dataUploads).toHaveLength(2)

    const draw = device.draws.length - 1
    expect(boundTexture(device, draw, 1)).toBe(device.dataUploads[0].tex)
    expect(boundTexture(device, draw, 2)).toBe(boundTexture(device, draw, 0))
    expect(boundTexture(device, draw, 3)).toBe(src.texture)
    expect(device.layoutEntries.at(-1)!.map((e) => e.binding)).toEqual([
      0, 1, 2, 3,
    ])
  })

  it('rejects a pass that reads one that does not run before it', () => {
    const device = new MockGfxDevice()
    const { chain } = setup(device)
    const later = plainPass()
    const early = plainPass({ textures: [later] })
    expect(() =>
      chain.prepare([new TestEffect([early, later])], 'linear'),
    ).toThrow(/does not run before/)
  })

  it('rejects more extra textures than the bindings allow', () => {
    const device = new MockGfxDevice()
    const { chain } = setup(device)
    const many = plainPass({ textures: Array(5).fill('source') })
    expect(() => chain.prepare([new TestEffect([many])], 'linear')).toThrow(
      /most is 4/,
    )
  })

  it('returns every pooled target once the chain is released', async () => {
    const device = new MockGfxDevice()
    const { chain, pool } = setup(device)
    const first = plainPass()
    const effects = [
      new TestEffect([first, plainPass(), plainPass({ textures: [first] })]),
    ]
    await prepared(chain, effects)
    const src = makeSource(device)
    chain.release(chain.run(src, effects, 'linear', null)!)
    pool.endFrame()
    const live =
      device.renderTargets.length - device.deletedRenderTargetHandles.length
    chain.release(chain.run(src, effects, 'linear', null)!)
    pool.endFrame()
    expect(
      device.renderTargets.length - device.deletedRenderTargetHandles.length,
    ).toBe(live)
  })
})

describe('PostChain data passes', () => {
  function dataPass(extra: Partial<PostDataPass> = {}): PostDataPass {
    return {
      kind: 'data',
      size: (source) => ({
        width: source.width / 4,
        height: source.height / 4,
      }),
      paramsBytes: 16,
      writeParams: (ctx, out) => {
        out[0] = ctx.width
      },
      ...extra,
    }
  }

  const reader = (data: PostDataPass) =>
    plainPass({ input: 'source', textures: [data] })

  /** Prepares until every pipeline, render and compute, has compiled. */
  async function ready(chain: PostChain, effects: PostEffect[]) {
    await prepared(chain, effects)
  }

  describe('on a device with compute', () => {
    it('dispatches the compute shader into a storage texture the next pass reads', async () => {
      const device = new MockGfxDevice('webgpu')
      const { chain } = setup(device)
      const data = dataPass({
        compute: { wgsl: '', workgroups: (ctx) => [ctx.width, ctx.height, 1] },
      })
      const effects = [new TestEffect([plainPass(), data, reader(data)])]
      await ready(chain, effects)
      const src = makeSource(device, 64, 32)
      chain.release(chain.run(src, effects, 'linear', null)!)

      expect(device.computeDispatches).toHaveLength(1)
      expect(device.computeDispatches[0]).toMatchObject({ x: 16, y: 8, z: 1 })
      const storage = device.textureOpts.find((opts) => opts.storage)
      expect(storage).toMatchObject({ width: 16, height: 8 })
      expect(
        device.layoutEntries.some((e) =>
          e.some((b) => b.type === 'storage-texture-2d'),
        ),
      ).toBe(true)
      // The reading pass is the second draw. It binds the output at 1.
      expect(boundTexture(device, 1, 1)).toBe(
        device.textures[device.textureOpts.indexOf(storage!)],
      )
    })

    it('is not ready until the compute pipeline has compiled', async () => {
      const device = new MockGfxDevice('webgpu')
      const { chain } = setup(device)
      const data = dataPass({
        compute: { wgsl: '', workgroups: () => [1, 1, 1] },
      })
      const effects = [new TestEffect([plainPass(), data, reader(data)])]
      expect(chain.prepare(effects, 'linear')).toBe(false)
      await ready(chain, effects)
      expect(chain.prepare(effects, 'linear')).toBe(true)
    })

    it('runs the compute shader every run, with no readback', async () => {
      const device = new MockGfxDevice('webgpu')
      const { chain } = setup(device)
      const data = dataPass({
        compute: { wgsl: '', workgroups: () => [1, 1, 1] },
        cpu: () => {
          throw new Error('cpu must not run')
        },
      })
      const effects = [new TestEffect([plainPass(), data, reader(data)])]
      await ready(chain, effects)
      const src = makeSource(device)
      for (let i = 0; i < 3; i++)
        chain.release(chain.run(src, effects, 'linear', null)!)
      expect(device.computeDispatches).toHaveLength(3)
      expect(device.readbacks).toHaveLength(0)
    })
  })

  describe('on a device without compute', () => {
    function setupCpu(cpu: PostDataPass['cpu']) {
      const device = new MockGfxDevice('webgl2')
      const { chain } = setup(device)
      const data = dataPass({
        compute: { wgsl: '', workgroups: () => [1, 1, 1] },
        cpu,
      })
      const effects = [new TestEffect([plainPass(), data, reader(data)])]
      return { device, chain, data, effects }
    }
    const frame = (
      chain: PostChain,
      device: MockGfxDevice,
      effects: PostEffect[],
    ) => {
      chain.advance(0.016)
      chain.release(
        chain.run(makeSource(device, 64, 32), effects, 'linear', null)!,
      )
    }

    it('reads the input back without waiting, and runs cpu when it arrives', async () => {
      const calls: Array<{ width: number; height: number; first: number }> = []
      const { device, chain, effects } = setupCpu((input, output) => {
        calls.push({
          width: input.width,
          height: input.height,
          first: input.data[0],
        })
        output.fill(7)
      })
      device.readbackSource = () => new Uint8Array(64 * 32 * 4).fill(9)
      await ready(chain, effects)

      frame(chain, device, effects)
      expect(device.readbacks).toHaveLength(1)
      expect(calls).toHaveLength(0)
      // Zero until the result lands.
      expect(device.dataUploads).toHaveLength(0)

      chain.advance(0.016)
      chain.advance(0.016)
      expect(calls).toEqual([{ width: 64, height: 32, first: 9 }])
      expect(device.dataUploads).toHaveLength(1)
      expect(device.dataUploads[0].data.byteLength).toBe(16 * 8 * 4)
      expect(
        Array.from(device.dataUploads[0].data as Uint8ClampedArray).every(
          (b) => b === 7,
        ),
      ).toBe(true)
    })

    it('starts one read at a time', async () => {
      const { device, chain, effects } = setupCpu(() => {})
      device.readbackLatency = 5
      await ready(chain, effects)
      for (let i = 0; i < 4; i++) frame(chain, device, effects)
      expect(device.readbacks).toHaveLength(1)
    })

    it('runs cpu again only when the pixels or the params change', async () => {
      let runs = 0
      const { device, chain, effects, data } = setupCpu(() => {
        runs++
      })
      await ready(chain, effects)
      const settle = () => {
        for (let i = 0; i < 4; i++) frame(chain, device, effects)
      }
      settle()
      expect(runs).toBe(1)
      // The same pixels and params read again do nothing.
      settle()
      expect(runs).toBe(1)
      // New pixels run it again.
      device.readbackSource = () => new Uint8Array(64 * 32 * 4).fill(3)
      settle()
      expect(runs).toBe(2)
      // New params do too.
      data.writeParams = (_ctx, out) => {
        out[0] = 99
      }
      settle()
      expect(runs).toBe(3)
    })

    it('reports a changed result to a cached layer once, when it arrives', async () => {
      const { device, chain, effects } = setupCpu(() => {})
      await ready(chain, effects)
      const src = { width: 64, height: 32 }
      chain.advance(0.016)
      expect(chain.paramsChanged(src, effects)).toBe(true)
      chain.release(
        chain.run(makeSource(device, 64, 32), effects, 'linear', null)!,
      )
      chain.advance(0.016)
      expect(chain.paramsChanged(src, effects)).toBe(false)
      chain.advance(0.016)
      // The read finished in this advance, so the result is new.
      expect(chain.paramsChanged(src, effects)).toBe(true)
      chain.advance(0.016)
      expect(chain.paramsChanged(src, effects)).toBe(false)
    })

    it('frees the texture and cancels a read when the effect goes', async () => {
      const { device, chain, effects } = setupCpu(() => {})
      device.readbackLatency = 10
      await ready(chain, effects)
      frame(chain, device, effects)
      chain.releaseEffect(effects[0])
      expect(device.readbacks[0].cancelled).toBe(true)
      expect(device.deletedTextures.length).toBeGreaterThan(0)
    })

    it('warns once and leaves the texture empty when it cannot run', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const device = new MockGfxDevice('webgl2')
      const { chain } = setup(device)
      const data = dataPass({
        compute: { wgsl: '', workgroups: () => [1, 1, 1] },
      })
      const effects = [new TestEffect([plainPass(), data, reader(data)])]
      await ready(chain, effects)
      for (let i = 0; i < 3; i++) frame(chain, device, effects)
      expect(warn).toHaveBeenCalledTimes(1)
      expect(device.readbacks).toHaveLength(0)
      warn.mockRestore()
    })
  })

  it('refuses a chain that ends in a data pass', () => {
    const device = new MockGfxDevice()
    const { chain } = setup(device)
    expect(() =>
      chain.prepare([new TestEffect([plainPass(), dataPass()])], 'linear'),
    ).toThrow(/last step/)
  })
})
