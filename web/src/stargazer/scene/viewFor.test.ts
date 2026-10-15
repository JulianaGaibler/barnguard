import { describe, expect, it } from 'vitest'
import { Camera } from '../camera/Camera'
import type { CameraView2D } from '../camera/CameraView2D'
import type { Stage } from '../render/Stage'
import { Layer } from './Layer'
import { Node2D } from './Node2D'
import { layerOf, viewFor } from './viewFor'

function stageWith(camera: CameraView2D | null, w = 800, h = 600): Stage {
  return {
    currentCamera2D: camera,
    renderer: { cssSize: { w, h } },
  } as unknown as Stage
}

describe('layerOf', () => {
  it('is null for a node no layer with a space is above', () => {
    const root = new Node2D()
    const world = new Layer()
    const child = new Node2D()
    root.add(world)
    world.add(child)
    expect(layerOf(child)).toBeNull()
  })

  it('finds the nearest layer with a space, the node itself included', () => {
    const outer = new Layer({ space: 'screen' })
    const inner = new Layer({
      space: { frame: { x: 0, y: 0, width: 10, height: 10 } },
    })
    const leaf = new Node2D()
    outer.add(inner)
    inner.add(leaf)
    expect(layerOf(leaf)).toBe(inner)
    expect(layerOf(inner)).toBe(inner)
    expect(layerOf(outer)).toBe(outer)
  })

  it('lets a world layer take the space of the layer above it', () => {
    const screen = new Layer({ space: 'screen' })
    const world = new Layer()
    const leaf = new Node2D()
    screen.add(world)
    world.add(leaf)
    expect(layerOf(leaf)).toBe(screen)
  })
})

describe('viewFor', () => {
  const camera = new Camera(
    { x: 0, y: 0, width: 100, height: 100 },
    { w: 800, h: 600 },
  )

  it('is the stage camera for a node outside any layer', () => {
    const node = new Node2D()
    expect(viewFor(node, stageWith(camera))).toBe(camera)
  })

  it('is null while the stage has no camera', () => {
    expect(viewFor(new Node2D(), stageWith(null))).toBeNull()
  })

  it('is the layer view, fitted to the canvas, under a layer with a space', () => {
    const layer = new Layer({ space: 'screen' })
    const node = new Node2D()
    layer.add(node)
    const view = viewFor(node, stageWith(camera, 640, 480))!
    expect(view).toBe(layer.view)
    const rect = view.visibleWorldRect()
    expect(rect.width).toBe(640)
    expect(rect.height).toBe(480)
  })

  it('follows a canvas resize', () => {
    const layer = new Layer({ space: 'screen' })
    const node = new Node2D()
    layer.add(node)
    viewFor(node, stageWith(camera, 640, 480))
    const view = viewFor(node, stageWith(camera, 1000, 500))!
    expect(view.visibleWorldRect().width).toBe(1000)
  })

  it('uses the debug camera for the stage camera and not for a layer', () => {
    const debugCamera = new Camera(
      { x: 0, y: 0, width: 1, height: 1 },
      { w: 1, h: 1 },
    )
    const debug = { activeCameraFor: () => debugCamera }
    const world = new Node2D()
    const layer = new Layer({ space: 'screen' })
    const inLayer = new Node2D()
    layer.add(inLayer)
    const stage = stageWith(camera)
    expect(viewFor(world, stage, debug)).toBe(debugCamera)
    expect(viewFor(inLayer, stage, debug)).toBe(layer.view)
  })
})
