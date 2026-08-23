import { describe, it, expect } from 'vitest'
import { fullscreenTri, PostProcessPipeline } from './PostProcessPipeline'
import { MockGfxDevice } from '../gfx/webgl2/mockGfxDevice'
import { ChromaticAberration } from './effects/ChromaticAberration'
import { Vignette } from './effects/Vignette'
import { VignetteBlur } from './effects/VignetteBlur'
import type { RenderTarget } from '../gfx/GfxDevice'
import { Engine } from '../../engine/Engine'

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
    // First synchronous run: pipeline not warm yet → present source, no passes.
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
