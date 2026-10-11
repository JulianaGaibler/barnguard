import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Engine } from '../engine/Engine'
import { MockGfxDevice } from './gfx/webgl2/mockGfxDevice'

/**
 * `StageOptions.renderScale` multiplies into the `dpr` a stage resizes to, so
 * its whole backing store (and everything that renders into it, including
 * post-processing) shrinks while the CSS size stays put.
 */
describe('StageOptions.renderScale', () => {
  const originalDpr = window.devicePixelRatio

  beforeEach(() => {
    Object.defineProperty(window, 'devicePixelRatio', {
      value: 2,
      configurable: true,
    })
  })

  afterEach(() => {
    Object.defineProperty(window, 'devicePixelRatio', {
      value: originalDpr,
      configurable: true,
    })
  })

  function makeEngine(): Engine {
    const canvas = document.createElement('canvas')
    return new Engine({ canvas, gpuDevice: new MockGfxDevice() })
  }

  it('defaults to devicePixelRatio unchanged', () => {
    const engine = makeEngine()
    const stage = engine.attachStage(document.createElement('canvas'), {
      gpuDevice: new MockGfxDevice(),
    })
    expect(stage.renderer.dpr).toBe(2)
    engine.destroy()
  })

  it('multiplies devicePixelRatio by renderScale', () => {
    const engine = makeEngine()
    const stage = engine.attachStage(document.createElement('canvas'), {
      gpuDevice: new MockGfxDevice(),
      renderScale: 0.5,
    })
    expect(stage.renderer.dpr).toBeCloseTo(1) // 2 * 0.5
    engine.destroy()
  })

  it('also applies to the primary stage via EngineOptions', () => {
    const canvas = document.createElement('canvas')
    const engine = new Engine({
      canvas,
      gpuDevice: new MockGfxDevice(),
      renderScale: 0.5,
    })
    expect(engine.primaryStage.renderer.dpr).toBeCloseTo(1) // 2 * 0.5
    engine.destroy()
  })

  it('clamps to [0.1, 2]', () => {
    const engine = makeEngine()
    const low = engine.attachStage(document.createElement('canvas'), {
      gpuDevice: new MockGfxDevice(),
      renderScale: 0,
    })
    expect(low.renderer.dpr).toBeCloseTo(0.2) // 2 * 0.1
    const high = engine.attachStage(document.createElement('canvas'), {
      gpuDevice: new MockGfxDevice(),
      renderScale: 10,
    })
    expect(high.renderer.dpr).toBeCloseTo(4) // 2 * 2
    engine.destroy()
  })
})
