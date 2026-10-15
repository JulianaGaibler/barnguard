import { describe, expect, it } from 'vitest'
import { Engine } from './Engine'
import { MockGfxDevice } from '../render/gfx/webgl2/mockGfxDevice'

function makeEngine(): Engine {
  return new Engine({
    canvas: document.createElement('canvas'),
    gpuDevice: new MockGfxDevice(),
  })
}

describe('Engine.attachStage', () => {
  it('draws into a target of its own when directPresent is false', () => {
    const engine = makeEngine()
    const device = new MockGfxDevice()
    engine.attachStage(document.createElement('canvas'), {
      gpuDevice: device,
      directPresent: false,
    })
    expect(device.renderTargets[0].colorSpace).toBe('linear')
    engine.destroy()
  })

  it('draws in the canvas format by default', () => {
    const engine = makeEngine()
    const device = new MockGfxDevice()
    engine.attachStage(document.createElement('canvas'), { gpuDevice: device })
    expect(device.renderTargets[0].colorSpace).toBe('canvas')
    engine.destroy()
  })

  it('gives the stage a physics world when asked', () => {
    const engine = makeEngine()
    const stage = engine.attachStage(document.createElement('canvas'), {
      gpuDevice: new MockGfxDevice(),
      physics: true,
    })
    expect(stage.physics).not.toBeNull()
    engine.destroy()
  })
})
