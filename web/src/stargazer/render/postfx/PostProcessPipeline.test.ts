import { describe, it, expect } from 'vitest'
import { PostProcessPipeline } from './PostProcessPipeline'
import { MockGfxDevice } from '../gfx/webgl2/mockGfxDevice'
import { ChromaticAberration } from './effects/ChromaticAberration'
import { Vignette } from './effects/Vignette'
import { VignetteBlur } from './effects/VignetteBlur'
import type { RenderTarget } from '../gfx/GfxDevice'
import { Engine } from '../../engine/Engine'

/** A screen-like MSAA source target for the pipeline to resolve. */
function makeSource(device: MockGfxDevice, w = 64, h = 32): RenderTarget {
  return device.createRenderTarget({
    width: w,
    height: h,
    samples: 4,
    colorSpace: 'linear',
  })
}

/** Number of fullscreen post-fx draws (clip-space triangle, 3 verts). */
function fullscreenDraws(device: MockGfxDevice): number {
  return device.draws.filter((d) => d.kind === 'arrays' && d.count === 3).length
}

/** Every captured uniform map that recorded `name`. */
function uniformMapsWith(
  device: MockGfxDevice,
  name: string,
): Map<string, Float32Array | number>[] {
  const out: Map<string, Float32Array | number>[] = []
  for (const byName of device.capturedUniforms.values() as Iterable<
    Map<string, Float32Array | number>
  >) {
    if (byName.has(name)) out.push(byName)
  }
  return out
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
    expect(device.resolves).toHaveLength(0)
    expect(device.blits).toHaveLength(0)
    expect(fullscreenDraws(device)).toBe(0)
  })

  it('resolves the MSAA source into a single-sample target once', () => {
    const device = new MockGfxDevice()
    const pp = new PostProcessPipeline(device)
    const source = makeSource(device)
    pp.add(new Vignette())
    pp.run(source, FRAME)

    expect(device.resolves).toHaveLength(1)
    expect(device.resolves[0].src).toBe(source)
    expect(device.resolves[0].src.samples).toBe(4)
    expect(device.resolves[0].dst.samples).toBe(1)
    expect(device.resolves[0].dst.colorSpace).toBe('linear')
  })

  it('draws one fullscreen pass per enabled pass, then presents once', () => {
    const device = new MockGfxDevice()
    const pp = new PostProcessPipeline(device)
    pp.add(new Vignette()) // 1 pass
    pp.add(new VignetteBlur()) // 2 passes
    pp.add(new ChromaticAberration()) // 1 pass
    pp.run(makeSource(device), FRAME)

    expect(fullscreenDraws(device)).toBe(4)
    // Exactly one present, of a single-sample target, at canvas size.
    expect(device.blits).toHaveLength(1)
    expect(device.blits[0].source.samples).toBe(1)
    expect(device.blits[0].dstWidth).toBe(FRAME.canvasW)
    expect(device.blits[0].dstHeight).toBe(FRAME.canvasH)
  })

  it('skips a disabled effect in the chain', () => {
    const device = new MockGfxDevice()
    const pp = new PostProcessPipeline(device)
    pp.add(new Vignette())
    pp.add(new VignetteBlur({ enabled: false }))
    pp.run(makeSource(device), FRAME)
    expect(fullscreenDraws(device)).toBe(1)
  })

  it('caches one program per pass across frames', () => {
    const device = new MockGfxDevice()
    const pp = new PostProcessPipeline(device)
    pp.add(new Vignette())
    pp.add(new VignetteBlur())
    pp.add(new ChromaticAberration())
    const source = makeSource(device)
    pp.run(source, FRAME)
    const afterFirst = device.programs.length
    expect(afterFirst).toBe(4) // 1 + 2 + 1 distinct passes
    pp.run(source, FRAME)
    expect(device.programs.length).toBe(afterFirst) // no recompiles
  })

  it('binds only the pooled ping-pong targets (never clears them)', () => {
    const device = new MockGfxDevice()
    const pp = new PostProcessPipeline(device)
    pp.add(new VignetteBlur()) // 2 passes → 2 binds
    pp.run(makeSource(device), FRAME)
    expect(device.boundTargets.length).toBe(2)
    for (const t of device.boundTargets) expect(t.samples).toBe(1)
    // Steady state uses exactly two pooled targets (ping-pong).
    expect(device.renderTargets.filter((r) => r.samples === 1)).toHaveLength(2)
  })

  it('reads effect params fresh each frame', () => {
    const device = new MockGfxDevice()
    const pp = new PostProcessPipeline(device)
    const v = new Vignette({ intensity: 0.8, radius: 0.3 })
    pp.add(v)
    const source = makeSource(device)
    pp.run(source, FRAME)
    let maps = uniformMapsWith(device, 'u_intensity')
    expect(maps).toHaveLength(1)
    expect(maps[0].get('u_intensity')).toBeCloseTo(0.8)
    expect(maps[0].get('u_radius')).toBeCloseTo(0.3)

    v.intensity = 0.2
    device.reset()
    pp.run(source, FRAME)
    maps = uniformMapsWith(device, 'u_intensity')
    expect(maps[0].get('u_intensity')).toBeCloseTo(0.2)
  })

  it('wires the blur H and V passes with distinct directions', () => {
    const device = new MockGfxDevice()
    const pp = new PostProcessPipeline(device)
    pp.add(new VignetteBlur())
    pp.run(makeSource(device, 100, 50), FRAME)
    const dirs = uniformMapsWith(device, 'u_dir').map(
      (m) => m.get('u_dir') as Float32Array,
    )
    expect(dirs).toHaveLength(2)
    // Horizontal pass: (texelW, 0); vertical pass: (0, texelH).
    const horiz = dirs.find((d) => d[1] === 0)
    const vert = dirs.find((d) => d[0] === 0)
    expect(horiz).toBeDefined()
    expect(vert).toBeDefined()
    expect(horiz![0]).toBeCloseTo(1 / 100)
    expect(vert![1]).toBeCloseTo(1 / 50)
  })

  it('reallocates and prunes pooled targets on a size change', () => {
    const device = new MockGfxDevice()
    const pp = new PostProcessPipeline(device)
    pp.add(new Vignette())
    pp.run(makeSource(device, 64, 32), FRAME)
    expect(device.deletedRenderTargets).toBe(0)
    // A differently-sized frame: the old pooled targets are stale and freed.
    pp.run(makeSource(device, 128, 64), {
      canvasW: 128,
      canvasH: 64,
      dt: 0.016,
    })
    expect(device.deletedRenderTargets).toBe(2)
  })

  it('rebuilds GPU resources after a context restore', () => {
    const device = new MockGfxDevice()
    const pp = new PostProcessPipeline(device)
    pp.add(new Vignette())
    const source = makeSource(device)
    pp.run(source, FRAME)
    const progsBefore = device.programs.length
    device.simulateContextRestored()
    // Fresh source (the old one's GL handle is dead after a real loss).
    expect(() => pp.run(makeSource(device), FRAME)).not.toThrow()
    // Program recompiled against the new context.
    expect(device.programs.length).toBe(progsBefore + 1)
  })

  it('frees a removed effect and goes inactive', () => {
    const device = new MockGfxDevice()
    const pp = new PostProcessPipeline(device)
    const v = new Vignette()
    pp.add(v)
    pp.run(makeSource(device), FRAME)
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
  it('uses the direct present path when no effect is active', () => {
    const device = new MockGfxDevice()
    const canvas = document.createElement('canvas')
    const engine = new Engine({ canvas, gpuDevice: device })
    device.reset()
    engine.primaryStage.render(0.016)
    // GpuGfx self-presents the screen target; no resolve pass.
    expect(device.resolves).toHaveLength(0)
    expect(device.blits).toHaveLength(1)
    engine.destroy()
  })

  it('routes through the pipeline once an effect is added', () => {
    const device = new MockGfxDevice()
    const canvas = document.createElement('canvas')
    const engine = new Engine({ canvas, gpuDevice: device })
    engine.postProcess.add(new Vignette())
    device.reset()
    engine.primaryStage.render(0.016)
    // The pipeline resolved the frame and presented; GpuGfx did not self-blit,
    // so the single present is of a single-sample pooled target.
    expect(device.resolves).toHaveLength(1)
    expect(device.resolves[0].src.samples).toBeGreaterThan(1)
    expect(device.blits).toHaveLength(1)
    expect(device.blits[0].source.samples).toBe(1)
    engine.destroy()
  })
})
