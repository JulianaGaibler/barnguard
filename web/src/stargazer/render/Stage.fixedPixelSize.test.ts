import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Engine } from '../engine/Engine'
import { MockGfxDevice } from './gfx/webgl2/mockGfxDevice'

describe('StageOptions.fixedPixelSize', () => {
  const originalDpr = window.devicePixelRatio
  let engine: Engine

  beforeEach(() => {
    Object.defineProperty(window, 'devicePixelRatio', {
      value: 2,
      configurable: true,
    })
    engine = new Engine({
      canvas: document.createElement('canvas'),
      gpuDevice: new MockGfxDevice(),
    })
  })

  afterEach(() => {
    engine.destroy()
    Object.defineProperty(window, 'devicePixelRatio', {
      value: originalDpr,
      configurable: true,
    })
  })

  function fixedStage(renderScale?: number) {
    const canvas = document.createElement('canvas')
    canvas.getBoundingClientRect = () => ({ width: 50, height: 50 }) as DOMRect
    const stage = engine.attachStage(canvas, {
      gpuDevice: new MockGfxDevice(),
      fixedPixelSize: { width: 312, height: 200 },
      renderScale,
    })
    return { canvas, stage }
  }

  it('renders at exactly that size, ignoring CSS size and pixel ratio', () => {
    const { canvas, stage } = fixedStage()
    expect(stage.renderer.pixelSize).toEqual({ w: 312, h: 200 })
    expect(stage.renderer.cssSize).toEqual({ w: 312, h: 200 })
    expect(stage.renderer.dpr).toBe(1)
    expect(canvas.width).toBe(312)
    expect(canvas.height).toBe(200)
  })

  it('ignores renderScale', () => {
    const { stage } = fixedStage(0.5)
    expect(stage.renderer.pixelSize).toEqual({ w: 312, h: 200 })
  })

  it('keeps its size through window resizes', () => {
    const { canvas, stage } = fixedStage()
    canvas.getBoundingClientRect = () =>
      ({ width: 900, height: 900 }) as DOMRect
    window.dispatchEvent(new Event('resize'))
    expect(stage.renderer.pixelSize).toEqual({ w: 312, h: 200 })
  })

  it('resizes through setFixedPixelSize', () => {
    const { stage } = fixedStage()
    stage.setFixedPixelSize(100, 40)
    expect(stage.renderer.pixelSize).toEqual({ w: 100, h: 40 })
    expect(stage.fixedPixelSize).toEqual({ width: 100, height: 40 })
  })

  it('stops following the CSS size once a stage switches to a fixed size', () => {
    const canvas = document.createElement('canvas')
    canvas.getBoundingClientRect = () => ({ width: 100, height: 50 }) as DOMRect
    const stage = engine.attachStage(canvas, { gpuDevice: new MockGfxDevice() })
    expect(stage.renderer.pixelSize).toEqual({ w: 200, h: 100 })
    stage.setFixedPixelSize(64, 64)
    canvas.getBoundingClientRect = () =>
      ({ width: 300, height: 300 }) as DOMRect
    window.dispatchEvent(new Event('resize'))
    expect(stage.renderer.pixelSize).toEqual({ w: 64, h: 64 })
  })
})
