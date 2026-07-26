import { describe, expect, it } from 'vitest'
import { Viewport2DNode } from './Viewport2DNode'
import { ShapeNode } from './ShapeNode'
import { MeshRenderer } from '../render/gfx/MeshRenderer'
import { MockGfxDevice } from '../render/gfx/webgl2/mockGfxDevice'
import { SceneTree } from '../scene/SceneTree'
import { Node3D } from '../scene/Node3D'
import { Camera3D } from '../camera/Camera3D'

function canvas(): HTMLCanvasElement {
  return document.createElement('canvas')
}

describe('Viewport2DNode', () => {
  it('starts the quad aspect-correct for the surface size', () => {
    const vp = new Viewport2DNode({ width: 400, height: 200 })
    expect(vp.transform.scale.x).toBeCloseTo(2, 5)
    expect(vp.transform.scale.y).toBeCloseTo(1, 5)
  })

  it('exposes a color texture after an offscreen render', () => {
    const device = new MockGfxDevice()
    const vp = new Viewport2DNode({ width: 128, height: 128 })
    vp.scene.root.add(
      new ShapeNode({ geometry: { kind: 'rect', width: 128, height: 128 }, fill: '#345' }),
    )
    expect(vp.colorTexture).toBeNull()
    vp.renderOffscreen(device, canvas(), 0)
    expect(vp.colorTexture).not.toBeNull()
  })
})

describe('MeshRenderer with Viewport2DNode', () => {
  it('draws the textured quad with the texture path enabled', () => {
    const device = new MockGfxDevice()
    const renderer = new MeshRenderer(device)
    const world = new SceneTree(new Node3D('world3d-root'))
    const camera = new Camera3D()
    camera.transform.setPosition(0, 0, 5)
    camera.setAspect(1)

    const vp = new Viewport2DNode({ width: 64, height: 64 })
    vp.transform.setPosition(0, 0, -2)
    world.add(vp)
    world.updateTransforms()
    vp.renderOffscreen(device, canvas(), 0)

    device.reset() // isolate the 3D-pass draws from the offscreen render
    renderer.render(camera, world.root)

    const quadDraws = device.draws.filter((d) => d.kind === 'elements')
    expect(quadDraws).toHaveLength(1)
    // The unit quad has 6 indices.
    expect(quadDraws[0].count).toBe(6)
  })
})
