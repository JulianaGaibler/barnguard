import { describe, it, expect } from 'vitest'
import { Camera } from '../camera/Camera'
import { SceneTree } from '../scene/SceneTree'
import { Node2D } from '../scene/Node2D'
import { Layer } from '../scene/Layer'
import type { Engine } from '../engine/Engine'
import type { Stage } from '../render/Stage'
import { LayoutRoot } from './LayoutRoot'
import { Column, Expanded } from './nodes/Flex'
import { SizedBox, Box } from './nodes/Box'

// A standalone Scene has no engine, so the root skips its self-registration and
// resize wiring. The test drives the pass directly with an explicit camera,
// which exercises the measure/arrange/bounds path without a full Engine.
describe('LayoutRoot', () => {
  it('measures and arranges content to fill the camera visible rect', () => {
    const camera = new Camera(
      { x: 0, y: 0, width: 400, height: 300 },
      { w: 400, h: 300 },
    )
    const root = new LayoutRoot({ camera })
    const scene = new SceneTree(new Node2D('scene-root'))
    scene.root.add(root)

    const header = new SizedBox({ width: 400, height: 50 })
    const body = new Expanded({ child: new Box() })
    root.setContent(
      new Column({ crossAxisAlign: 'stretch', children: [header, body] }),
    )

    root._runIfDirty()

    // Content filled 400×300: header on top, body takes the remaining 250.
    expect(header.transform.y).toBe(0)
    expect(body.transform.y).toBe(50)
    expect(body.measuredSize.h).toBe(250)
  })

  it('re-runs on requestLayout and is a no-op while clean', () => {
    const camera = new Camera(
      { x: 0, y: 0, width: 200, height: 200 },
      { w: 200, h: 200 },
    )
    const root = new LayoutRoot({ camera })
    const scene = new SceneTree(new Node2D('scene-root'))
    scene.root.add(root)
    const child = new Box()
    root.setContent(child)

    root._runIfDirty()
    expect(child.measuredSize).toEqual({ w: 200, h: 200 })

    // Grow the camera, but the root only reflows when told to.
    camera.setViewport({ x: 0, y: 0, width: 300, height: 300 })
    camera.setPixelSize(300, 300)
    root._runIfDirty() // still clean -> no-op
    expect(child.measuredSize).toEqual({ w: 200, h: 200 })

    root.requestLayout()
    root._runIfDirty()
    expect(child.measuredSize).toEqual({ w: 300, h: 300 })
  })
})

describe('LayoutRoot under a Layer', () => {
  /**
   * Give a scene an engine that reports one stage with the given camera. Done
   * after the root joins the scene, so the root skips registering with it.
   */
  function useEngine(
    scene: SceneTree,
    camera: Camera,
    w: number,
    h: number,
  ): void {
    const stage = {
      currentCamera2D: camera,
      renderer: { cssSize: { w, h } },
    } as unknown as Stage
    scene.engine = {
      stageForScene: () => stage,
      currentCamera2D: camera,
    } as unknown as Engine
  }

  it('fills the visible rect of the layer, not the camera', () => {
    // The camera frames 100 by 100. The screen layer is the 400 by 300 canvas.
    const camera = new Camera(
      { x: 0, y: 0, width: 100, height: 100 },
      { w: 400, h: 300 },
    )
    const scene = new SceneTree(new Node2D('scene-root'))
    const layer = new Layer({ space: 'screen' })
    const root = new LayoutRoot()
    scene.root.add(layer)
    layer.add(root)
    const child = new Box()
    root.setContent(child)
    useEngine(scene, camera, 400, 300)
    root._runIfDirty()
    expect(child.measuredSize).toEqual({ w: 400, h: 300 })
  })

  it('still fills the camera rect outside a layer', () => {
    const camera = new Camera(
      { x: 0, y: 0, width: 100, height: 100 },
      { w: 100, h: 100 },
    )
    const scene = new SceneTree(new Node2D('scene-root'))
    const root = new LayoutRoot()
    scene.root.add(root)
    const child = new Box()
    root.setContent(child)
    useEngine(scene, camera, 400, 300)
    root._runIfDirty()
    expect(child.measuredSize).toEqual({ w: 100, h: 100 })
  })
})
