import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Engine } from './Engine'
import { SceneNode } from '../scene/SceneNode'
import { MockGfxDevice } from '../render/gfx/webgl2/mockGfxDevice'

/**
 * happy-dom's `<canvas>` doesn't return a real WebGL2 context, but `GpuGfx`
 * only needs it for `canvas.width` / `canvas.height` bookkeeping and the FBO
 * blit destination; all GL calls go through the injected mock device.
 */
function makeCanvas(): HTMLCanvasElement {
  return document.createElement('canvas')
}

describe('Engine per-stage active flag', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('secondary stages default to active', () => {
    const engine = new Engine({
      canvas: makeCanvas(),
      gpuDevice: new MockGfxDevice(),
    })
    const stage = engine.attachStage(makeCanvas(), {
      gpuDevice: new MockGfxDevice(),
    })
    expect(stage.active).toBe(true)
    engine.destroy()
  })

  it('setActive toggles the flag', () => {
    const engine = new Engine({
      canvas: makeCanvas(),
      gpuDevice: new MockGfxDevice(),
    })
    const stage = engine.attachStage(makeCanvas(), {
      gpuDevice: new MockGfxDevice(),
    })
    stage.setActive(false)
    expect(stage.active).toBe(false)
    stage.setActive(true)
    expect(stage.active).toBe(true)
    engine.destroy()
  })

  it('skips render + transform + fixed-step work for inactive secondary stages, primary keeps running', () => {
    const engine = new Engine({
      canvas: makeCanvas(),
      gpuDevice: new MockGfxDevice(),
    })
    const stage = engine.attachStage(makeCanvas(), {
      gpuDevice: new MockGfxDevice(),
    })

    // A child with fixed-step work so `#fixedStep`'s walk actually visits it.
    const stepFn = vi.fn()
    const stepNode = new SceneNode()
    stepNode.onFixedStep = stepFn
    stepNode._recomputeHasWork()
    stage.scene.root.add(stepNode)

    const secondaryRender = vi.spyOn(stage, 'render')
    const secondaryTransforms = vi.spyOn(stage, 'updateTransforms')
    const primaryRender = vi.spyOn(engine.primaryStage, 'render')

    engine.start()
    for (let i = 0; i < 4; i++) vi.advanceTimersToNextFrame()
    expect(secondaryRender).toHaveBeenCalled()
    expect(secondaryTransforms).toHaveBeenCalled()
    expect(stepFn).toHaveBeenCalled()
    expect(primaryRender).toHaveBeenCalled()

    secondaryRender.mockClear()
    secondaryTransforms.mockClear()
    stepFn.mockClear()
    primaryRender.mockClear()
    stage.setActive(false)
    for (let i = 0; i < 4; i++) vi.advanceTimersToNextFrame()

    expect(secondaryRender).not.toHaveBeenCalled()
    expect(secondaryTransforms).not.toHaveBeenCalled()
    expect(stepFn).not.toHaveBeenCalled()
    expect(primaryRender).toHaveBeenCalled()

    engine.destroy()
  })
})
