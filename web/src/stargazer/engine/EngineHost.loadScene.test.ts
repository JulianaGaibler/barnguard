import { describe, it, expect } from 'vitest'
import { createEngineHost } from './EngineHost'
import { MockGfxDevice } from '../render/gfx/webgl2/mockGfxDevice'
import { CameraNode2D } from '../camera/CameraNode2D'
import { Node2D } from '../scene/Node2D'

describe('EngineHost.loadScene', () => {
  it('wipes prior content; a camera the builder adds becomes current', async () => {
    const canvas = document.createElement('canvas')
    const host = createEngineHost({ canvas, gpuDevice: new MockGfxDevice() })
    const stage = host.engine.primaryStage

    await host.loadScene((scene) => {
      const cam = new CameraNode2D('game-camera')
      cam.setViewport({ x: 0, y: 0, width: 100, height: 100 })
      scene.root.add(cam)
      cam.makeCurrent()
      scene.root.add(new Node2D('game-content'))
    })
    const firstCam = stage.currentCamera2D
    expect(firstCam).not.toBe(null)

    // A second scene with no camera wipes the first (no auto-created default).
    await host.loadScene(() => {})
    expect(firstCam?.isDestroyed).toBe(true)
    expect(stage.currentCamera2D).toBe(null)

    host.destroy()
  })
})
