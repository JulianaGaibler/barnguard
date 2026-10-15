import { describe, expect, it } from 'vitest'
import { SceneTree } from '../scene/SceneTree'
import { Node2D } from '../scene/Node2D'
import { StageLayerRenderer } from './StageLayerRenderer'
import type { Affine2x3, CameraView2D } from '../camera/CameraView2D'
import type { Gfx2D } from './gfx/Gfx2D'
import type { Renderer } from './Renderer'

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
  } as unknown as Gfx2D
  scene.updateTransforms()
  new StageLayerRenderer().drawLayer(
    scene,
    renderer,
    'dynamic',
    gfx,
    camera,
    affine,
    0,
  )
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
      'clip',
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
      'clip',
      'save',
      'clip',
      'draw leaf',
      'restore',
      'restore',
    ])
    outer.clip = null
    inner.clip = null
  })
})
