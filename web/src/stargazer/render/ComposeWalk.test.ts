import { describe, expect, it } from 'vitest'
import { SceneTree } from '../scene/SceneTree'
import { Node2D } from '../scene/Node2D'
import { ComposeWalk } from './ComposeWalk'
import type { Affine2x3, CameraView2D } from '../camera/CameraView2D'
import type { Gfx2D } from './gfx/Gfx2D'
import type { Renderer } from './Renderer'
import { GfxPath } from './gfx/GfxPath'

const affine: Affine2x3 = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }
const camera = {
  screenToWorld: (x: number, y: number, out?: { x: number; y: number }) =>
    Object.assign(out ?? { x: 0, y: 0 }, { x, y }),
  strokeSpaceScale: () => 1,
  getScreenAffine: () => affine,
} as unknown as CameraView2D
const renderer = { cssSize: { w: 1000, h: 1000 } } as unknown as Renderer

class Drawer extends Node2D {
  readonly #log: string[]
  readonly #name: string
  constructor(log: string[], name: string) {
    super()
    this.#log = log
    this.#name = name
  }
  override draw(): void {
    this.#log.push(`draw ${this.#name}`)
  }
}

function render(scene: SceneTree, log: string[]): void {
  const gfx = {
    setBaseTransform: () => {},
    setAlpha: () => {},
    save: () => log.push('save'),
    restore: () => log.push('restore'),
    clipPath: () => log.push('clip'),
    setClip: () => log.push('setClip'),
  } as unknown as Gfx2D
  scene.updateTransforms()
  new ComposeWalk().draw(scene, renderer, gfx, camera, affine, 0)
}

describe('Node2D.clip', () => {
  it('clips a subtree once for consecutive nodes and releases it after', () => {
    const scene = new SceneTree()
    const log: string[] = []
    const panel = new Node2D()
    panel.clip = { x: 0, y: 0, width: 100, height: 100 }
    const a = new Drawer(log, 'a')
    const b = new Drawer(log, 'b')
    panel.add(a)
    panel.add(b)
    const outside = new Drawer(log, 'outside')
    scene.root.add(panel)
    scene.root.add(outside)
    render(scene, log)
    expect(log).toEqual([
      'save',
      'setClip',
      'draw a',
      'draw b',
      'restore',
      'draw outside',
    ])
    panel.clip = null
  })

  it('draws without clip calls when no node has a clip', () => {
    const scene = new SceneTree()
    const log: string[] = []
    scene.root.add(new Drawer(log, 'a'))
    render(scene, log)
    expect(log).toEqual(['draw a'])
  })

  it('narrows with nested clips, outermost first', () => {
    const scene = new SceneTree()
    const log: string[] = []
    const outer = new Node2D()
    outer.clip = { x: 0, y: 0, width: 100, height: 100 }
    const inner = new Node2D()
    inner.clip = { x: 10, y: 10, width: 20, height: 20 }
    outer.add(inner)
    inner.add(new Drawer(log, 'leaf'))
    scene.root.add(outer)
    render(scene, log)
    expect(log).toEqual([
      'save',
      'setClip',
      'save',
      'clip',
      'draw leaf',
      'restore',
      'restore',
    ])
    outer.clip = null
    inner.clip = null
  })

  it('clips a rotated rectangle and a path with the stencil', () => {
    const scene = new SceneTree()
    const log: string[] = []
    const rotated = new Node2D()
    rotated.transform.rotation = 0.5
    rotated.clip = { x: 0, y: 0, width: 100, height: 100 }
    rotated.add(new Drawer(log, 'a'))
    const path = new Node2D()
    path.clip = new GfxPath().moveTo(0, 0).lineTo(10, 0).lineTo(10, 10).close()
    path.add(new Drawer(log, 'b'))
    scene.root.add(rotated, path)
    render(scene, log)
    expect(log).toEqual([
      'save',
      'clip',
      'draw a',
      'restore',
      'save',
      'clip',
      'draw b',
      'restore',
    ])
  })
})

/** Draws record the alpha they see, in draw order. */
function renderAlphas(scene: SceneTree): string[] {
  const seen: string[] = []
  let alpha = 1
  const gfx = {
    setBaseTransform: () => {},
    setAlpha: (a: number) => {
      alpha = a
    },
    save: () => {},
    restore: () => {},
    clipPath: () => {},
  } as unknown as Gfx2D
  scene.updateTransforms()
  const walk = new ComposeWalk()
  for (const n of scene.getPainterOrder()) {
    const draw = n.draw
    if (!draw) continue
    n.draw = function (this: Node2D, ...args) {
      seen.push(`${n.id}:${alpha}`)
      return draw.apply(this, args)
    }
  }
  walk.draw(scene, renderer, gfx, camera, affine, 0)
  return seen
}

describe('ComposeWalk order and alpha', () => {
  it('draws in tree order, a node before its children', () => {
    const scene = new SceneTree()
    const log: string[] = []
    const parent = new Drawer(log, 'parent')
    parent.add(new Drawer(log, 'child'))
    scene.root.add(parent)
    scene.root.add(new Drawer(log, 'sibling'))
    render(scene, log)
    expect(log).toEqual(['draw parent', 'draw child', 'draw sibling'])
  })

  it('skips a hidden subtree', () => {
    const scene = new SceneTree()
    const log: string[] = []
    const hidden = new Drawer(log, 'hidden')
    hidden.add(new Drawer(log, 'under hidden'))
    hidden.visible = false
    scene.root.add(hidden)
    scene.root.add(new Drawer(log, 'shown'))
    render(scene, log)
    expect(log).toEqual(['draw shown'])
  })

  it('multiplies a node alpha into everything under it', () => {
    const scene = new SceneTree()
    const log: string[] = []
    const a = new Drawer(log, 'a')
    a.transform.alpha = 0.5
    const b = new Node2D('b')
    b.transform.alpha = 0.5
    const c = new Drawer(log, 'c')
    c.transform.alpha = 0.5
    a.add(b)
    b.add(c)
    scene.root.add(a)
    const seen = renderAlphas(scene)
    expect(seen).toEqual([`${a.id}:0.5`, `${c.id}:0.125`])
  })
})
