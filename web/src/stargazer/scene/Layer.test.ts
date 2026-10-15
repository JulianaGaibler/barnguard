import { describe, expect, it } from 'vitest'
import { Layer } from './Layer'
import type { PostEffect } from '../render/postfx/PostEffect'
import { Node2D } from './Node2D'
import { SceneTree } from './SceneTree'

function makeScene(): SceneTree {
  return new SceneTree(new Node2D('scene-root'))
}

describe('Layer', () => {
  it('composes a world layer with its parent as any node does', () => {
    const scene = makeScene()
    const parent = new Node2D()
    parent.transform.x = 100
    const layer = new Layer()
    layer.transform.x = 5
    const child = new Node2D()
    child.transform.x = 1
    scene.root.add(parent)
    parent.add(layer)
    layer.add(child)
    scene.updateTransforms()
    expect(layer.transform.world.e).toBe(105)
    expect(child.transform.world.e).toBe(106)
  })

  it('starts a new space when the layer has a space of its own', () => {
    const scene = makeScene()
    const parent = new Node2D()
    parent.transform.x = 100
    const layer = new Layer({ space: 'screen' })
    layer.transform.x = 5
    layer.transform.y = 6
    const child = new Node2D()
    child.transform.x = 1
    child.transform.y = 1
    scene.root.add(parent)
    parent.add(layer)
    layer.add(child)
    scene.updateTransforms()
    expect(layer.transform.world.e).toBe(5)
    expect(layer.transform.world.f).toBe(6)
    expect(child.transform.world.e).toBe(6)
    expect(child.transform.world.f).toBe(7)
  })

  it('takes its own transform as the root transform of the space', () => {
    const scene = makeScene()
    const layer = new Layer({ space: 'screen' })
    layer.transform.scaleX = 2
    layer.transform.scaleY = 2
    const child = new Node2D()
    child.transform.x = 3
    scene.root.add(layer)
    layer.add(child)
    scene.updateTransforms()
    expect(child.transform.world.e).toBe(6)
    expect(child.transform.world.a).toBe(2)
  })

  it('recomposes the subtree when its space changes', () => {
    const scene = makeScene()
    const parent = new Node2D()
    parent.transform.x = 100
    const layer = new Layer()
    const child = new Node2D()
    scene.root.add(parent)
    parent.add(layer)
    layer.add(child)
    scene.updateTransforms()
    expect(child.transform.world.e).toBe(100)

    layer.space = 'screen'
    scene.updateTransforms()
    expect(child.transform.world.e).toBe(0)

    layer.space = 'world'
    scene.updateTransforms()
    expect(child.transform.world.e).toBe(100)
  })

  it('has no view in world space and a view once it has a space', () => {
    const layer = new Layer()
    expect(layer.view).toBeNull()
    layer.space = 'screen'
    expect(layer.view).not.toBeNull()
  })

  it('maps one unit to one pixel on a screen layer', () => {
    const layer = new Layer({ space: 'screen' })
    layer._syncView(800, 600)
    const view = layer.view!
    expect(view.screenToWorld(10, 20)).toEqual({ x: 10, y: 20 })
    expect(view.screenPxPerWorldUnit()).toBe(1)
    const rect = view.visibleWorldRect()
    expect(rect.x).toBeCloseTo(0)
    expect(rect.y).toBeCloseTo(0)
    expect(rect.width).toBe(800)
    expect(rect.height).toBe(600)
  })

  it('fits the frame of a frame layer into the canvas, centered', () => {
    const layer = new Layer({
      space: { frame: { x: 0, y: 0, width: 1920, height: 1080 } },
    })
    layer._syncView(960, 810)
    const view = layer.view!
    expect(view.screenPxPerWorldUnit()).toBe(0.5)
    // 960 by 540 of the canvas holds the frame, centered in 810 of height.
    expect(view.worldToScreen(0, 0)).toEqual({ x: 0, y: 135 })
    expect(view.worldToScreen(1920, 1080)).toEqual({ x: 960, y: 675 })
    // The letterbox is still in the visible rect.
    const rect = view.visibleWorldRect()
    expect(rect.y).toBe(-270)
    expect(rect.height).toBe(1620)
  })

  it('keeps alpha and visibility cascading from above', () => {
    const scene = makeScene()
    const layer = new Layer({ space: 'screen' })
    layer.transform.alpha = 0.5
    scene.root.add(layer)
    expect(layer.transform.alpha).toBe(0.5)
    layer.visible = false
    expect(layer.visible).toBe(false)
  })
})

function effectWith(passes: number, enabled = true): PostEffect {
  return {
    enabled,
    passes: Array.from({ length: passes }, () => ({
      shader: {
        glsl: { vertex: '', fragment: '' },
        wgsl: { code: '', vertexEntry: '', fragmentEntry: '' },
        reflection: { attributes: [], uniformBlocks: [], samplers: [] },
      },
      paramsBytes: 0,
    })),
  }
}

describe('Layer effects', () => {
  it('has none by default and reports them applied', () => {
    const layer = new Layer()
    expect(layer.effects).toEqual([])
    expect(layer.region).toBe('content')
    expect(layer.padding).toBe(0)
    expect(layer.clearColor).toBeNull()
    expect(layer._hasEffects()).toBe(false)
    expect(layer.effectsApplied).toBe(true)
  })

  it('has effects while one enabled effect has a pass', () => {
    const layer = new Layer({ effects: [effectWith(0), effectWith(1, false)] })
    expect(layer._hasEffects()).toBe(false)
    const on = effectWith(2)
    layer.effects = [on]
    expect(layer._hasEffects()).toBe(true)
    on.enabled = false
    expect(layer._hasEffects()).toBe(false)
  })

  it('takes its options', () => {
    const layer = new Layer({
      effects: [effectWith(1)],
      region: 'view',
      padding: 12,
      clearColor: '#123456',
    })
    expect(layer.region).toBe('view')
    expect(layer.padding).toBe(12)
    expect(layer.clearColor).toBe('#123456')
  })

  it('warms nothing while it is not in a scene', () => {
    expect(() => new Layer({ effects: [effectWith(1)] }).warm()).not.toThrow()
  })
})

describe('Layer cache', () => {
  it('is off by default and uses no surface without effects', () => {
    const layer = new Layer()
    expect(layer.cache).toBe('none')
    expect(layer._usesSurface()).toBe(false)
  })

  it('uses a surface when it keeps its render, even without effects', () => {
    const layer = new Layer({ cache: 'raster' })
    expect(layer._usesSurface()).toBe(true)
  })

  it('hands the renderer a cache state that invalidate marks', () => {
    const layer = new Layer({ cache: 'raster' })
    expect(layer._cacheState.invalidated).toBe(false)
    layer.invalidate()
    expect(layer._cacheState.invalidated).toBe(true)
  })
})

describe('Node.persistent', () => {
  it('survives destroyChildren and keeps its descendants', () => {
    const scene = makeScene()
    const kept = new Layer({ persistent: true })
    const inner = new Node2D()
    kept.add(inner)
    const dropped = new Node2D()
    scene.root.add(kept)
    scene.root.add(dropped)
    scene.root.destroyChildren()
    expect(kept.isDestroyed).toBe(false)
    expect(inner.isDestroyed).toBe(false)
    expect(dropped.isDestroyed).toBe(true)
    expect(scene.root.children).toContain(kept)
  })

  it('can still be destroyed directly', () => {
    const scene = makeScene()
    const kept = new Layer({ persistent: true })
    scene.root.add(kept)
    kept.destroy()
    expect(kept.isDestroyed).toBe(true)
  })
})
