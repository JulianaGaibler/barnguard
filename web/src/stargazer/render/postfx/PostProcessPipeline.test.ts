import { describe, it, expect } from 'vitest'
import { fullscreenTri, PostProcessPipeline } from './PostProcessPipeline'
import { MockGfxDevice } from '../gfx/webgl2/mockGfxDevice'
import { ChromaticAberration } from './effects/ChromaticAberration'
import { Vignette } from './effects/Vignette'
import { VignetteBlur } from './effects/VignetteBlur'
import { DualKawaseBlur } from './effects/DualKawaseBlur'
import { FilmGrain } from './effects/FilmGrain'
import { postShader } from './PostEffect'
import type { PostEffect, PostPass, PostPassContext } from './PostEffect'
import type { RenderTarget, ShaderReflection } from '../gfx/GfxDevice'
import { Engine } from '../../engine/Engine'

const EMPTY_REFLECTION: ShaderReflection = {
  attributes: [],
  uniformBlocks: [],
  samplers: [],
}

/** A minimal pass for tests that don't care about real shader content. */
function testPass(opts: Partial<PostPass> = {}): PostPass {
  return {
    shader: postShader('', '', '', EMPTY_REFLECTION),
    paramsBytes: 0,
    ...opts,
  }
}

/** A `PostEffect` whose `passes` can be swapped after construction. */
class TestEffect implements PostEffect {
  enabled = true
  passes: PostPass[]
  constructor(passes: PostPass[]) {
    this.passes = passes
  }
}

/**
 * A resolved single-sample source, as the pipeline now receives (the screen's
 * GpuGfx resolves MSAA before handing it over).
 */
function makeSource(device: MockGfxDevice, w = 64, h = 32): RenderTarget {
  return device.createRenderTarget({
    width: w,
    height: h,
    samples: 1,
    colorSpace: 'linear',
  })
}

/** Number of fullscreen post-fx draws (clip-space triangle, 3 verts). */
function fullscreenDraws(device: MockGfxDevice): number {
  return device.draws.filter((d) => d.kind === 'arrays' && d.count === 3).length
}

/** Params-UBO uploads of the given std140 byte size, as float views. */
function paramUploads(device: MockGfxDevice, bytes: number): Float32Array[] {
  return device.uniformUploads
    .filter((u) => u.data.byteLength === bytes)
    .map((u) => new Float32Array(u.data.buffer, u.data.byteOffset, bytes / 4))
}

/**
 * Run the pipeline, retrying across microtasks until its pass pipelines have
 * compiled (they warm asynchronously). Returns once a fullscreen pass drew.
 */
async function warmRun(
  pp: PostProcessPipeline,
  device: MockGfxDevice,
  source: RenderTarget,
  frame: { canvasW: number; canvasH: number; dt: number },
): Promise<void> {
  for (let i = 0; i < 80; i++) {
    device.reset()
    pp.run(source, frame)
    if (fullscreenDraws(device) > 0) return
    await Promise.resolve()
  }
}

const FRAME = { canvasW: 64, canvasH: 32, dt: 0.016 }

describe('PostProcessPipeline', () => {
  it('is inactive with no effects, or only disabled ones', () => {
    const device = new MockGfxDevice()
    const pp = new PostProcessPipeline(device)
    expect(pp.active).toBe(false)
    pp.add(new Vignette({ enabled: false }))
    expect(pp.active).toBe(false)
    pp.add(new Vignette())
    expect(pp.active).toBe(true)
  })

  it('run is a no-op while inactive', () => {
    const device = new MockGfxDevice()
    const pp = new PostProcessPipeline(device)
    pp.run(makeSource(device), FRAME)
    expect(device.presents).toHaveLength(0)
    expect(fullscreenDraws(device)).toBe(0)
  })

  it('draws one fullscreen pass per enabled pass, then presents once', async () => {
    const device = new MockGfxDevice()
    const pp = new PostProcessPipeline(device)
    pp.add(new Vignette()) // 1 pass
    pp.add(new VignetteBlur()) // 2 passes
    pp.add(new ChromaticAberration()) // 1 pass
    await warmRun(pp, device, makeSource(device), FRAME)

    expect(fullscreenDraws(device)).toBe(4)
    // Exactly one present, of a single-sample target, at canvas size.
    expect(device.presents).toHaveLength(1)
    expect(device.presents[0].source.samples).toBe(1)
    expect(device.presents[0].dstWidth).toBe(FRAME.canvasW)
    expect(device.presents[0].dstHeight).toBe(FRAME.canvasH)
  })

  it('warm compiles a disabled effect, so enabling it never stalls', async () => {
    // Enabling an effect switches the stage off the direct-present path and
    // compiles its shaders in the same frame. That stall is long enough to read
    // as the screen flickering, so it has to be payable in advance.
    const device = new MockGfxDevice()
    const pp = new PostProcessPipeline(device)
    const effect = new ChromaticAberration({ enabled: false })
    pp.add(effect)
    expect(device.pipelines).toHaveLength(0)

    pp.warm()
    await Promise.resolve()
    expect(device.pipelines.length).toBeGreaterThan(0)

    // Now the first enabled run draws straight away rather than falling back to
    // presenting the source untouched.
    const compiled = device.pipelines.length
    effect.enabled = true
    pp.run(makeSource(device), FRAME)
    expect(fullscreenDraws(device)).toBe(1)
    expect(device.pipelines).toHaveLength(compiled)
  })

  it('warm is idempotent', async () => {
    const device = new MockGfxDevice()
    const pp = new PostProcessPipeline(device)
    pp.add(new Vignette())
    pp.warm()
    await Promise.resolve()
    const after = device.pipelines.length
    pp.warm()
    await Promise.resolve()
    expect(device.pipelines).toHaveLength(after)
  })

  it('presents the source unmodified while pass pipelines are still compiling', () => {
    const device = new MockGfxDevice()
    const pp = new PostProcessPipeline(device)
    const source = makeSource(device)
    pp.add(new Vignette())
    // First synchronous run: pipeline not warm yet -> present source, no passes.
    pp.run(source, FRAME)
    expect(fullscreenDraws(device)).toBe(0)
    expect(device.presents).toHaveLength(1)
    expect(device.presents[0].source).toBe(source)
  })

  it('skips a disabled effect in the chain', async () => {
    const device = new MockGfxDevice()
    const pp = new PostProcessPipeline(device)
    pp.add(new Vignette())
    pp.add(new VignetteBlur({ enabled: false }))
    await warmRun(pp, device, makeSource(device), FRAME)
    expect(fullscreenDraws(device)).toBe(1)
  })

  it('caches one shader per pass across frames', async () => {
    const device = new MockGfxDevice()
    const pp = new PostProcessPipeline(device)
    pp.add(new Vignette())
    pp.add(new VignetteBlur())
    pp.add(new ChromaticAberration())
    const source = makeSource(device)
    await warmRun(pp, device, source, FRAME)
    const afterFirst = device.programs.length
    expect(afterFirst).toBe(4) // 1 + 2 + 1 distinct passes
    pp.run(source, FRAME)
    expect(device.programs.length).toBe(afterFirst) // no recompiles
  })

  it('runs each blur pass into its own single-sample pooled target', async () => {
    const device = new MockGfxDevice()
    const pp = new PostProcessPipeline(device)
    pp.add(new VignetteBlur()) // 2 passes
    await warmRun(pp, device, makeSource(device), FRAME)
    // Two color passes into single-sample ping-pong targets.
    const colorPasses = device.passes.filter((p) => p.desc.color !== undefined)
    expect(colorPasses).toHaveLength(2)
    expect(device.renderTargets.filter((r) => r.samples === 1)).toHaveLength(3)
  })

  it('reads effect params fresh each frame', async () => {
    const device = new MockGfxDevice()
    const pp = new PostProcessPipeline(device)
    const v = new Vignette({ intensity: 0.8, radius: 0.3 })
    pp.add(v)
    const source = makeSource(device)
    await warmRun(pp, device, source, FRAME)
    let params = paramUploads(device, 16) // vec4 u_vig
    expect(params).toHaveLength(1)
    expect(params[0][0]).toBeCloseTo(0.8) // intensity
    expect(params[0][1]).toBeCloseTo(0.3) // radius

    v.intensity = 0.2
    device.reset()
    pp.run(source, FRAME)
    params = paramUploads(device, 16)
    expect(params[0][0]).toBeCloseTo(0.2)
  })

  it('wires the blur H and V passes with distinct directions', async () => {
    const device = new MockGfxDevice()
    const pp = new PostProcessPipeline(device)
    pp.add(new VignetteBlur())
    await warmRun(pp, device, makeSource(device, 100, 50), {
      canvasW: 100,
      canvasH: 50,
      dt: 0.016,
    })
    // u_p0 = (dirX, dirY, radius, softness). Two 32-byte param uploads (H, V).
    const dirs = paramUploads(device, 32)
    expect(dirs).toHaveLength(2)
    const horiz = dirs.find((d) => d[1] === 0)
    const vert = dirs.find((d) => d[0] === 0)
    expect(horiz).toBeDefined()
    expect(vert).toBeDefined()
    expect(horiz![0]).toBeCloseTo(1 / 100)
    expect(vert![1]).toBeCloseTo(1 / 50)
  })

  it('reallocates and prunes pooled targets on a size change', async () => {
    const device = new MockGfxDevice()
    const pp = new PostProcessPipeline(device)
    pp.add(new Vignette())
    await warmRun(pp, device, makeSource(device, 64, 32), FRAME)
    const deletedBefore = device.deletedRenderTargets
    // A differently-sized frame: the old-size pooled target is stale and freed.
    pp.run(makeSource(device, 128, 64), {
      canvasW: 128,
      canvasH: 64,
      dt: 0.016,
    })
    expect(device.deletedRenderTargets).toBeGreaterThan(deletedBefore)
  })

  it('a pass with scale acquires a smaller pooled target', async () => {
    const device = new MockGfxDevice()
    const pp = new PostProcessPipeline(device)
    pp.add(new TestEffect([testPass({ scale: 0.5 })]))
    await warmRun(pp, device, makeSource(device, 64, 32), FRAME)
    const halfSize = device.renderTargets.filter(
      (r) => r.width === 32 && r.height === 16,
    )
    expect(halfSize.length).toBeGreaterThan(0)
  })

  it('reports source and destination sizes separately across a scale change', async () => {
    const device = new MockGfxDevice()
    const pp = new PostProcessPipeline(device)
    const contexts: PostPassContext[] = []
    const capture = (scale?: number): PostPass =>
      testPass({
        scale,
        paramsBytes: 16,
        writeParams: (ctx) => {
          contexts.push(ctx)
        },
      })
    pp.add(new TestEffect([capture(0.5), capture(1)]))
    await warmRun(pp, device, makeSource(device, 64, 32), FRAME)

    expect(contexts).toHaveLength(2)
    const [down, up] = contexts
    expect([down.width, down.height]).toEqual([32, 16])
    expect([down.inputWidth, down.inputHeight]).toEqual([64, 32])
    // The second pass reads the first pass's half-size output.
    expect([up.width, up.height]).toEqual([64, 32])
    expect([up.inputWidth, up.inputHeight]).toEqual([32, 16])
  })

  it('a rebuilt pass list releases the old passes GPU resources', async () => {
    const device = new MockGfxDevice()
    const pp = new PostProcessPipeline(device)
    const effect = new TestEffect([testPass({ paramsBytes: 16 })])
    pp.add(effect)
    const source = makeSource(device)
    await warmRun(pp, device, source, FRAME)

    effect.passes = [testPass({ paramsBytes: 16 })]
    await warmRun(pp, device, source, FRAME)
    // Held through the grace period, so a cycling effect gets its passes back
    // without a recompile.
    expect(device.deletedShaderModules).toBe(0)

    for (let i = 0; i < 260; i++) pp.run(source, FRAME)
    expect(device.deletedShaderModules).toBeGreaterThan(0)
    expect(device.deletedUniformBuffers).toBeGreaterThan(0)
  })

  it('rebuilds GPU resources after a context restore', async () => {
    const device = new MockGfxDevice()
    const pp = new PostProcessPipeline(device)
    pp.add(new Vignette())
    await warmRun(pp, device, makeSource(device), FRAME)
    const progsBefore = device.programs.length
    device.simulateContextRestored()
    // A fresh run recreates the pass shader (synchronously) against the new
    // context. The pipeline recompiles asynchronously.
    expect(() => pp.run(makeSource(device), FRAME)).not.toThrow()
    expect(device.programs.length).toBe(progsBefore + 1)
  })

  it('frees a removed effect and goes inactive', async () => {
    const device = new MockGfxDevice()
    const pp = new PostProcessPipeline(device)
    const v = new Vignette()
    pp.add(v)
    await warmRun(pp, device, makeSource(device), FRAME)
    pp.remove(v)
    expect(pp.active).toBe(false)
    device.reset()
    pp.run(makeSource(device), FRAME)
    expect(fullscreenDraws(device)).toBe(0)
  })
})

describe('post-fx effect params', () => {
  it('ChromaticAberration defaults', () => {
    const e = new ChromaticAberration()
    expect(e.enabled).toBe(true)
    expect(e.amount).toBeCloseTo(0.006)
    expect(e.passes).toHaveLength(1)
  })
  it('Vignette defaults', () => {
    const e = new Vignette()
    expect(e.enabled).toBe(true)
    expect(e.intensity).toBeCloseTo(0.5)
    expect(e.passes).toHaveLength(1)
  })
  it('VignetteBlur is a two-pass separable blur', () => {
    const e = new VignetteBlur({ strength: 8 })
    expect(e.strength).toBe(8)
    expect(e.passes).toHaveLength(2)
  })
  it('DualKawaseBlur defaults to a 4-level, 8-pass chain', () => {
    const e = new DualKawaseBlur()
    expect(e.levels).toBe(4)
    expect(e.passes).toHaveLength(8)
  })
  it('FilmGrain defaults', () => {
    const e = new FilmGrain()
    expect(e.enabled).toBe(true)
    expect(e.cellPx).toBe(2)
    expect(e.density).toBe(0.5)
    expect(e.opacity).toBeCloseTo(0.15)
    expect(e.hz).toBe(0) // static unless asked for
    expect(e.passes).toHaveLength(1)
  })
})

describe('FilmGrain', () => {
  const CTX: PostPassContext = {
    width: 1,
    height: 1,
    texelW: 1,
    texelH: 1,
    inputWidth: 1,
    inputHeight: 1,
    inputTexelW: 1,
    inputTexelH: 1,
    uvYDown: true,
    time: 0,
    dt: 0,
  }

  it('writes cellPx, density, opacity, and tint into params', async () => {
    const device = new MockGfxDevice()
    const pp = new PostProcessPipeline(device)
    pp.add(
      new FilmGrain({
        cellPx: 4,
        density: 0.3,
        opacity: 0.2,
        tint: '#ff0000',
      }),
    )
    await warmRun(pp, device, makeSource(device), FRAME)
    const params = paramUploads(device, 32)
    expect(params).toHaveLength(1)
    expect(params[0][0]).toBe(4)
    expect(params[0][1]).toBeCloseTo(0.3)
    expect(params[0][2]).toBeCloseTo(0.2)
    expect([params[0][4], params[0][5], params[0][6]]).toEqual([1, 0, 0])
  })

  it('advances the frame index at hz and wraps modulo 1024', () => {
    const grain = new FilmGrain({ hz: 10 })
    const out = new Float32Array(8)
    grain.passes[0].writeParams!({ ...CTX, time: 2.37 }, out)
    expect(out[3]).toBe(23)
    grain.passes[0].writeParams!({ ...CTX, time: 200 }, out)
    expect(out[3]).toBe(2000 % 1024)
  })

  it('freezes the frame index when hz is 0', () => {
    const grain = new FilmGrain({ hz: 0 })
    const out = new Float32Array(8)
    grain.passes[0].writeParams!({ ...CTX, time: 999 }, out)
    expect(out[3]).toBe(0)
  })
})

describe('DualKawaseBlur', () => {
  it('builds 2*levels passes, halving scale down then back up to 1', () => {
    const blur = new DualKawaseBlur({ levels: 3 })
    expect(blur.passes.map((p) => p.scale)).toEqual([
      0.5, 0.25, 0.125, 0.25, 0.5, 1,
    ])
  })

  it('clamps levels to the supported range', () => {
    expect(new DualKawaseBlur({ levels: 0 }).levels).toBe(1)
    expect(new DualKawaseBlur({ levels: 99 }).levels).toBe(6)
  })

  it('down passes read the destination texel, up passes the source one', () => {
    const blur = new DualKawaseBlur({ levels: 2, offset: 3 })
    const ctx: PostPassContext = {
      width: 10,
      height: 20,
      texelW: 1 / 10,
      texelH: 1 / 20,
      inputWidth: 100,
      inputHeight: 200,
      inputTexelW: 1 / 100,
      inputTexelH: 1 / 200,
      uvYDown: true,
      time: 0,
      dt: 0,
    }
    const downOut = new Float32Array(4)
    blur.passes[0].writeParams!(ctx, downOut)
    expect(downOut[0]).toBeCloseTo(1 / 10)
    expect(downOut[1]).toBeCloseTo(1 / 20)
    expect(downOut[2]).toBe(3)

    const finalUp = blur.passes[blur.passes.length - 1]
    const upOut = new Float32Array(4)
    finalUp.writeParams!(ctx, upOut)
    expect(upOut[0]).toBeCloseTo(1 / 100)
    expect(upOut[1]).toBeCloseTo(1 / 200)
  })

  it('downsamples through pooled half/quarter targets and back to full size', async () => {
    const device = new MockGfxDevice()
    const pp = new PostProcessPipeline(device)
    pp.add(new DualKawaseBlur({ levels: 2 }))
    await warmRun(pp, device, makeSource(device, 64, 32), FRAME)
    const sizes = device.renderTargets.map((r) => `${r.width}x${r.height}`)
    expect(sizes).toContain('32x16')
    expect(sizes).toContain('16x8')
    expect(device.presents[0].dstWidth).toBe(FRAME.canvasW)
    expect(device.presents[0].dstHeight).toBe(FRAME.canvasH)
  })

  it('reuses pass objects across a levels change', () => {
    const blur = new DualKawaseBlur({ levels: 6 })
    const deep = new Set(blur.passes)
    blur.levels = 2
    // Every pass of the shallower chain is one the deeper chain already used,
    // so the pipeline's compiled resources for them stay valid.
    for (const pass of blur.passes) expect(deep.has(pass)).toBe(true)
  })

  it('changing levels never drops a frame once the deepest chain is warm', async () => {
    const device = new MockGfxDevice()
    const pp = new PostProcessPipeline(device)
    const blur = new DualKawaseBlur({ levels: 6 })
    pp.add(blur)
    const source = makeSource(device, 64, 32)
    await warmRun(pp, device, source, FRAME)

    // A recompile makes `run` present the source unmodified, which reads as
    // the whole effect flashing off for a frame.
    for (const levels of [5, 4, 3, 2, 1, 2, 3, 4, 5, 6]) {
      blur.levels = levels
      device.reset()
      pp.run(source, FRAME)
      expect(fullscreenDraws(device), `levels ${levels}`).toBe(levels * 2)
    }
  })
})

describe('Stage post-process wiring', () => {
  /** Render frames (draining microtasks) until the stage presents once. */
  async function renderUntilPresent(
    engine: Engine,
    device: MockGfxDevice,
  ): Promise<void> {
    for (let i = 0; i < 100; i++) {
      device.reset()
      engine.primaryStage.render(0.016)
      if (device.presents.length > 0) return
      await Promise.resolve()
    }
  }

  it('uses the direct present path when no effect is active', async () => {
    const device = new MockGfxDevice()
    const canvas = document.createElement('canvas')
    const engine = new Engine({ canvas, gpuDevice: device })
    await renderUntilPresent(engine, device)
    // GpuGfx self-presents the resolved screen target.
    expect(device.presents).toHaveLength(1)
    expect(device.presents[0].source.samples).toBe(1)
    engine.destroy()
  })

  it('routes through the pipeline once an effect is added', async () => {
    const device = new MockGfxDevice()
    const canvas = document.createElement('canvas')
    const engine = new Engine({ canvas, gpuDevice: device })
    engine.postProcess.add(new Vignette())
    await renderUntilPresent(engine, device)
    // The pipeline (or its warming fallback) presents a single-sample target.
    // GpuGfx did not self-present.
    expect(device.presents).toHaveLength(1)
    expect(device.presents[0].source.samples).toBe(1)
    engine.destroy()
  })
})

describe('fullscreen triangle orientation', () => {
  /** Interpolate the triangle's `v` at a clip-space y, as the rasterizer does. */
  function vAtClipY(tri: Float32Array, clipY: number): number {
    // The two vertices sharing x = -1 span the full y range, so `v` is linear
    // between them.
    const y0 = tri[1]
    const v0 = tri[3]
    const y2 = tri[9]
    const v2 = tri[11]
    return v0 + ((clipY - y0) / (y2 - y0)) * (v2 - v0)
  }

  it('carries a uv per vertex alongside the position', () => {
    expect(fullscreenTri(false)).toHaveLength(12)
    expect(fullscreenTri(false).byteLength).toBe(48)
  })

  it('covers the viewport with the same clip-space triangle either way', () => {
    const gl = fullscreenTri(false)
    const gpu = fullscreenTri(true)
    for (const i of [0, 4, 8]) {
      expect(gpu[i]).toBe(gl[i])
      expect(gpu[i + 1]).toBe(gl[i + 1])
    }
  })

  it('samples the source top row at the top of the screen, on both backends', () => {
    // The bug this pins: deriving `uv` from the clip position samples the
    // source upside down wherever a render target stores row 0 at the top, so
    // one enabled effect flipped the whole frame on WebGPU.
    //
    // Clip y = +1 is the top of the viewport. The v it must read is whichever
    // one addresses the source's first row: 0 where textures are top-down
    // (WebGPU), 1 where they are bottom-up (WebGL2).
    expect(vAtClipY(fullscreenTri(true), 1)).toBeCloseTo(0, 6)
    expect(vAtClipY(fullscreenTri(false), 1)).toBeCloseTo(1, 6)
  })

  it('samples the source bottom row at the bottom of the screen', () => {
    expect(vAtClipY(fullscreenTri(true), -1)).toBeCloseTo(1, 6)
    expect(vAtClipY(fullscreenTri(false), -1)).toBeCloseTo(0, 6)
  })

  it('leaves u alone, since the backends agree on column order', () => {
    const gl = fullscreenTri(false)
    const gpu = fullscreenTri(true)
    for (const i of [2, 6, 10]) expect(gpu[i]).toBe(gl[i])
  })
})
