import { describe, expect, it, vi } from 'vitest'
import { Camera } from '../camera/Camera'
import type { Affine2x3, CameraView2D } from '../camera/CameraView2D'
import { InsetViewNode } from '../nodes/InsetViewNode'
import { ShapeNode } from '../nodes/ShapeNode'
import { Layer } from '../scene/Layer'
import { Node2D } from '../scene/Node2D'
import { SceneTree } from '../scene/SceneTree'
import { ComposeWalk } from './ComposeWalk'
import type { Gfx2D, GfxOffscreenOptions } from './gfx/Gfx2D'
import type { PostEffect } from './postfx/PostEffect'
import type { Canvas } from './picture/Canvas'
import type { Renderer } from './Renderer'

interface Seen {
  name: string
  base: number[]
  alpha: number
  view: CameraView2D
}

/** A draw-mode node that records the transform, alpha and view it drew with. */
class Probe extends Node2D {
  readonly seen: Seen[]
  readonly name: string
  readonly rec: { base: number[]; alpha: number }
  constructor(
    name: string,
    seen: Seen[],
    rec: { base: number[]; alpha: number },
    bounds = true,
  ) {
    super(name)
    this.name = name
    this.seen = seen
    this.rec = rec
    if (bounds) this.boundsOverride = { x: 0, y: 0, width: 10, height: 10 }
  }
  override draw(_gfx: Gfx2D, view: CameraView2D): void {
    this.seen.push({
      name: this.name,
      base: [...this.rec.base],
      alpha: this.rec.alpha,
      view,
    })
  }
}

/** A node that paints from the screen scale, so it repaints when that moves. */
class ScaleNode extends Node2D {
  paints = 0
  override paint(c: Canvas): void {
    this.paints++
    c.screenScale()
    c.fillRect(0, 0, 10, 10, '#fff')
  }
}

interface Frame {
  seen: Seen[]
  /** The options of every `beginOffscreen` the walk made. */
  offscreen: GfxOffscreenOptions[]
  /** The signature of each cached layer the walk described, one per frame. */
  signatures: number[][]
  /** Whether the stand-in renderer reports a kept render as standing. */
  keep: { on: boolean }
  walk: ComposeWalk
  scene: SceneTree
  /** Draw the scene through a camera framing `viewport` on the canvas. */
  render(viewport?: { width: number; height: number }): void
  rec: { base: number[]; alpha: number }
}

function frame(css = { w: 200, h: 100 }, dpr = 1): Frame {
  const seen: Seen[] = []
  const offscreen: GfxOffscreenOptions[] = []
  const signatures: number[][] = []
  const keep = { on: false }
  const rec = { base: [1, 0, 0, 1, 0, 0], alpha: 1 }
  const gfx = new Proxy(
    {},
    {
      get(_t, key) {
        if (key === 'setBaseTransform') {
          return (...m: number[]) => {
            rec.base = m
          }
        }
        if (key === 'beginOffscreen') {
          return (opts: GfxOffscreenOptions) => {
            offscreen.push(opts)
            const cache = opts.effects?.cache
            if (cache) {
              signatures.push(
                Array.from(cache.signature.subarray(0, cache.length)),
              )
              cache.hit = keep.on
            }
            // Stand in for the renderer reporting that the effects will run.
            if (opts.effects) opts.effects.applied = true
            return true
          }
        }
        if (key === 'endOffscreen') return () => null
        if (key === 'setAlpha') {
          return (a: number) => {
            rec.alpha = a
          }
        }
        return () => undefined
      },
    },
  ) as unknown as Gfx2D
  const renderer = { cssSize: css, dpr } as unknown as Renderer
  const scene = new SceneTree(new Node2D('scene-root'))
  const walk = new ComposeWalk()
  // The checker paints clean nodes again to compare, which would count here.
  walk.stalenessSamples = 0
  return {
    seen,
    offscreen,
    signatures,
    keep,
    walk,
    scene,
    rec,
    render(viewport = { width: css.w, height: css.h }) {
      const camera = new Camera({ x: 0, y: 0, ...viewport }, css)
      const s = camera.getScreenAffine()
      const render: Affine2x3 = {
        a: dpr * s.a,
        b: dpr * s.b,
        c: dpr * s.c,
        d: dpr * s.d,
        e: dpr * s.e,
        f: dpr * s.f,
      }
      scene.updateTransforms()
      walk.draw(scene, renderer, gfx, camera, render, 0)
    },
  }
}

describe('ComposeWalk with a Layer', () => {
  it('places a screen layer by pixels whatever the camera does', () => {
    const f = frame()
    const layer = new Layer({ space: 'screen' })
    const hud = new Probe('hud', f.seen, f.rec)
    hud.transform.x = 10
    hud.transform.y = 20
    const world = new Probe('world', f.seen, f.rec)
    world.transform.x = 10
    world.transform.y = 20
    layer.add(hud)
    f.scene.root.add(layer)
    f.scene.root.add(world)

    f.render({ width: 200, height: 100 })
    const atRest = f.seen.map((s) => s.base.slice(4))
    f.seen.length = 0
    // Zoom the camera in 4x.
    f.render({ width: 50, height: 25 })
    const zoomed = f.seen.map((s) => s.base.slice(4))

    expect(atRest[0]).toEqual([10, 20])
    expect(zoomed[0]).toEqual([10, 20])
    expect(atRest[1]).toEqual([10, 20])
    expect(zoomed[1]).toEqual([40, 80])
  })

  it('fits a frame layer into the canvas and scales by device pixels', () => {
    const f = frame({ w: 960, h: 540 }, 2)
    const layer = new Layer({
      space: { frame: { x: 0, y: 0, width: 1920, height: 1080 } },
    })
    const corner = new Probe('corner', f.seen, f.rec)
    corner.transform.x = 1920
    corner.transform.y = 1080
    layer.add(corner)
    f.scene.root.add(layer)
    f.render()
    // 0.5 css px per unit, doubled by the device pixel ratio.
    expect(f.seen[0].base).toEqual([1, 0, 0, 1, 1920, 1080])
  })

  it('puts the camera back for what comes after the layer', () => {
    const f = frame()
    const layer = new Layer({ space: 'screen' })
    layer.add(new Probe('inside', f.seen, f.rec))
    const after = new Probe('after', f.seen, f.rec)
    after.transform.x = 10
    f.scene.root.add(layer)
    f.scene.root.add(after)
    f.render({ width: 50, height: 25 })
    expect(f.seen.map((s) => s.name)).toEqual(['inside', 'after'])
    expect(f.seen[1].base.slice(4)).toEqual([40, 0])
    expect(f.seen[1].view).not.toBe(f.seen[0].view)
  })

  it('culls by the layer view, not the camera', () => {
    const f = frame()
    const layer = new Layer({ space: 'screen' })
    const far = new Probe('far', f.seen, f.rec)
    far.transform.x = 5000
    layer.add(far)
    const world = new Probe('world', f.seen, f.rec)
    world.transform.x = 5000
    f.scene.root.add(layer)
    f.scene.root.add(world)
    // A camera that frames x = 5000, so the world node is on screen.
    f.scene.updateTransforms()
    f.render({ width: 10000, height: 5000 })
    expect(f.seen.map((s) => s.name)).toEqual(['world'])
  })

  it('cascades the layer alpha into its subtree', () => {
    const f = frame()
    const layer = new Layer({ space: 'screen' })
    layer.transform.alpha = 0.5
    const child = new Probe('child', f.seen, f.rec)
    child.transform.alpha = 0.5
    layer.add(child)
    f.scene.root.add(layer)
    f.render()
    expect(f.seen[0].alpha).toBe(0.25)
  })

  it('nests spaces and restores each on the way out', () => {
    const f = frame()
    const outer = new Layer({ space: 'screen' })
    const inner = new Layer({
      space: { frame: { x: 0, y: 0, width: 400, height: 200 } },
    })
    const a = new Probe('a', f.seen, f.rec)
    a.transform.x = 100
    const b = new Probe('b', f.seen, f.rec)
    b.transform.x = 100
    outer.add(inner)
    inner.add(a)
    outer.add(b)
    f.scene.root.add(outer)
    f.render()
    // The frame is twice the canvas, so inner content draws at half size.
    expect(f.seen.find((s) => s.name === 'a')!.base.slice(4)).toEqual([50, 0])
    expect(f.seen.find((s) => s.name === 'b')!.base.slice(4)).toEqual([100, 0])
  })

  it('does not repaint a screen layer picture when the camera zooms', () => {
    const f = frame()
    const layer = new Layer({ space: 'screen' })
    const hud = new ScaleNode()
    layer.add(hud)
    const world = new ScaleNode()
    f.scene.root.add(layer)
    f.scene.root.add(world)
    f.render({ width: 200, height: 100 })
    f.render({ width: 100, height: 50 })
    f.render({ width: 50, height: 25 })
    expect(hud.paints).toBe(1)
    expect(world.paints).toBeGreaterThan(1)
  })

  it('binds an inset in a layer to the layer view', () => {
    const f = frame({ w: 960, h: 540 })
    const layer = new Layer({
      space: { frame: { x: 0, y: 0, width: 1920, height: 1080 } },
    })
    const inset = new InsetViewNode({ width: 100, height: 100 })
    const inner = new Probe('inner', f.seen, f.rec)
    inset.content.add(inner)
    layer.add(inset)
    f.scene.root.add(layer)
    // The camera frames 100 units across 960 pixels, so it scales by 9.6.
    f.render({ width: 100, height: 56.25 })
    expect(f.seen[0].view.screenPxPerWorldUnit()).toBeCloseTo(0.5)
  })
})

/** An effect with one pass, enough for a layer to count as having effects. */
function anEffect(enabled = true): PostEffect {
  return {
    enabled,
    passes: [
      {
        shader: {
          glsl: { vertex: '', fragment: '' },
          wgsl: { code: '', vertexEntry: '', fragmentEntry: '' },
          reflection: { attributes: [], uniformBlocks: [], samplers: [] },
        },
        paramsBytes: 0,
      },
    ],
  }
}

/** A filled rect, which is a painted node with known bounds. */
function rect(x: number, y: number, w: number, h: number): ShapeNode {
  const node = new ShapeNode({
    geometry: { kind: 'rect', width: w, height: h, centered: false },
    fill: '#fff',
  })
  node.transform.x = x
  node.transform.y = y
  return node
}

describe('ComposeWalk with a Layer that has effects', () => {
  it('draws the subtree into a surface with the layer effects', () => {
    const f = frame()
    const effects = [anEffect()]
    const layer = new Layer({ space: 'screen', effects })
    layer.add(rect(10, 20, 40, 20))
    f.scene.root.add(layer)
    f.render()
    expect(f.offscreen).toHaveLength(1)
    expect(f.offscreen[0].effects).toBe(layer._fx)
    expect(layer._fx.effects).toBe(effects)
    expect(layer.effectsApplied).toBe(true)
  })

  it('bounds the surface by the subtree box plus the padding', () => {
    const f = frame()
    const layer = new Layer({
      space: 'screen',
      effects: [anEffect()],
      padding: 5,
    })
    layer.add(rect(10, 20, 40, 20))
    f.scene.root.add(layer)
    f.render()
    // The picture box is the rect plus 3 pixels of antialiasing slack, and the
    // padding goes on top of that.
    expect(f.offscreen[0].bounds).toEqual({
      x: 2,
      y: 12,
      width: 56,
      height: 36,
    })
  })

  it('scales the padding by the device pixel ratio', () => {
    const f = frame({ w: 200, h: 100 }, 2)
    const layer = new Layer({
      space: 'screen',
      effects: [anEffect()],
      padding: 5,
    })
    layer.add(rect(10, 20, 40, 20))
    f.scene.root.add(layer)
    f.render()
    // Device pixels: the rect doubles to (20, 40, 80, 40), the slack adds 3,
    // and the padding adds 10.
    expect(f.offscreen[0].bounds).toEqual({
      x: 7,
      y: 27,
      width: 106,
      height: 66,
    })
  })

  it("takes the whole canvas for a 'view' region", () => {
    const f = frame()
    const layer = new Layer({
      space: 'screen',
      effects: [anEffect()],
      region: 'view',
    })
    layer.add(rect(10, 20, 40, 20))
    f.scene.root.add(layer)
    f.render()
    expect(f.offscreen[0].bounds).toBeUndefined()
  })

  it('maps a rect region through the layer into device pixels', () => {
    const f = frame({ w: 200, h: 100 }, 2)
    const layer = new Layer({
      space: 'screen',
      effects: [anEffect()],
      region: { x: 5, y: 5, width: 50, height: 30 },
      padding: 1,
    })
    layer.transform.x = 10
    layer.add(rect(0, 0, 10, 10))
    f.scene.root.add(layer)
    f.render()
    // The rect at (15, 5) of size 50 by 30 doubles to (30, 10, 100, 60), and
    // the padding adds 2 on every side.
    expect(f.offscreen[0].bounds).toEqual({
      x: 28,
      y: 8,
      width: 104,
      height: 64,
    })
  })

  it('hands the renderer the clear color and the frame time', () => {
    const f = frame()
    const layer = new Layer({
      space: 'screen',
      effects: [anEffect()],
      clearColor: '#112233',
    })
    layer.add(rect(0, 0, 10, 10))
    f.scene.root.add(layer)
    f.render()
    expect(f.offscreen[0].clearColor).toBe('#112233')
  })

  it('uses no surface when no effect is enabled', () => {
    const f = frame()
    const layer = new Layer({ space: 'screen', effects: [anEffect(false)] })
    layer.add(rect(0, 0, 10, 10))
    f.scene.root.add(layer)
    f.render()
    expect(f.offscreen).toHaveLength(0)
    expect(layer.effectsApplied).toBe(true)
  })

  it('draws without effects, and says so, when the subtree holds an inset', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const f = frame()
    const layer = new Layer({
      id: 'panel',
      space: 'screen',
      effects: [anEffect()],
    })
    layer.add(new InsetViewNode({ width: 50, height: 50 }))
    f.scene.root.add(layer)
    f.render()
    f.render()
    expect(f.offscreen).toHaveLength(0)
    expect(layer.effectsApplied).toBe(false)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0][0])).toContain('panel')
    warn.mockRestore()
  })

  it('draws without effects when the layer sits inside an inset', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const f = frame()
    const inset = new InsetViewNode({ width: 100, height: 100 })
    const layer = new Layer({ effects: [anEffect()] })
    layer.add(rect(0, 0, 10, 10))
    inset.content.add(layer)
    f.scene.root.add(inset)
    f.render()
    expect(f.offscreen).toHaveLength(0)
    expect(layer.effectsApplied).toBe(false)
    warn.mockRestore()
  })
})

describe('ComposeWalk with a cached Layer', () => {
  /** A cached screen layer holding a few rects, to change one thing at a time. */
  function cached(f: Frame): { layer: Layer; a: ShapeNode; b: ShapeNode } {
    const layer = new Layer({
      space: 'screen',
      cache: 'raster',
      effects: [anEffect()],
    })
    const a = rect(10, 20, 40, 20)
    const b = rect(60, 20, 40, 20)
    layer.add(a)
    layer.add(b)
    f.scene.root.add(layer)
    return { layer, a, b }
  }

  /** Render twice and report whether the two frames described the same thing. */
  function repeats(f: Frame, change: () => void): boolean {
    f.render()
    f.render()
    const before = f.signatures.length
    change()
    f.render()
    const last = f.signatures[f.signatures.length - 1]
    const prior = f.signatures[before - 1]
    return JSON.stringify(last) === JSON.stringify(prior)
  }

  it('hands the renderer a signature that stays the same while nothing changes', () => {
    const f = frame()
    cached(f)
    f.render()
    f.render()
    expect(f.signatures).toHaveLength(2)
    expect(f.signatures[0].length).toBeGreaterThan(10)
    expect(f.signatures[0]).toEqual(f.signatures[1])
  })

  it('keeps the signature when the camera moves under a screen layer', () => {
    const f = frame()
    cached(f)
    f.render({ width: 200, height: 100 })
    f.render({ width: 50, height: 25 })
    expect(f.signatures[0]).toEqual(f.signatures[1])
  })

  it('changes the signature when a node moves', () => {
    const f = frame()
    const { a } = cached(f)
    expect(repeats(f, () => (a.transform.x = 12))).toBe(false)
  })

  it('changes the signature when a node is hidden or shown', () => {
    const f = frame()
    const { b } = cached(f)
    expect(repeats(f, () => (b.visible = false))).toBe(false)
  })

  it('changes the signature when a node changes alpha', () => {
    const f = frame()
    const { a } = cached(f)
    expect(repeats(f, () => (a.transform.alpha = 0.5))).toBe(false)
  })

  it('changes the signature when a node paints again', () => {
    const f = frame()
    const { a } = cached(f)
    expect(repeats(f, () => (a.fill = '#00ff00'))).toBe(false)
  })

  it('changes the signature when a node is added or removed', () => {
    const f = frame()
    const { layer, b } = cached(f)
    expect(repeats(f, () => layer.add(rect(0, 0, 5, 5)))).toBe(false)
    const g = frame()
    const second = cached(g)
    expect(repeats(g, () => second.layer.remove(second.b))).toBe(false)
    void b
  })

  it('changes the signature when the layer is cleared to another color', () => {
    const f = frame()
    const { layer } = cached(f)
    expect(repeats(f, () => (layer.clearColor = '#123456'))).toBe(false)
  })

  it('changes the signature when the canvas changes size', () => {
    const f = frame({ w: 200, h: 100 })
    cached(f)
    f.render()
    const g = frame({ w: 300, h: 100 })
    cached(g)
    g.render()
    expect(f.signatures[0]).not.toEqual(g.signatures[0])
  })

  it("keeps the signature when only the layer's own alpha changes", () => {
    const f = frame()
    const { layer } = cached(f)
    expect(repeats(f, () => (layer.transform.alpha = 0.3))).toBe(true)
  })

  it('moves a world layer by a camera pan in its signature', () => {
    const f = frame()
    const layer = new Layer({ cache: 'raster', effects: [anEffect()] })
    layer.add(rect(10, 20, 40, 20))
    f.scene.root.add(layer)
    f.render({ width: 200, height: 100 })
    f.render({ width: 100, height: 50 })
    expect(f.signatures[0]).not.toEqual(f.signatures[1])
  })

  it('skips the subtree when the renderer keeps the render', () => {
    const f = frame()
    cached(f)
    f.render()
    const drawn = f.walk.stats.replays
    expect(drawn).toBe(2)
    f.keep.on = true
    f.render()
    expect(f.walk.stats.replays).toBe(0)
  })

  it('renders every frame and warns when a node draws immediately', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const f = frame()
    const layer = new Layer({
      id: 'live',
      space: 'screen',
      cache: 'raster',
      effects: [anEffect()],
    })
    layer.add(new Probe('live-node', f.seen, f.rec))
    f.scene.root.add(layer)
    f.render()
    f.render()
    expect(f.signatures[0]).not.toEqual(f.signatures[1])
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0][0])).toContain('live')
    warn.mockRestore()
  })

  it('runs a copy when a cached layer has no effects', () => {
    const f = frame()
    const layer = new Layer({ space: 'screen', cache: 'raster' })
    layer.add(rect(10, 20, 40, 20))
    f.scene.root.add(layer)
    f.render()
    expect(f.offscreen).toHaveLength(1)
    // One pass that copies, since the layer has none of its own.
    const run = f.offscreen[0].effects!.effects
    expect(run).toHaveLength(1)
    expect(run[0].passes).toHaveLength(1)
    expect(run).not.toBe(layer.effects)
  })

  it('does not use the cache for a layer that does not ask for it', () => {
    const f = frame()
    const layer = new Layer({ space: 'screen', effects: [anEffect()] })
    layer.add(rect(10, 20, 40, 20))
    f.scene.root.add(layer)
    f.render()
    expect(f.offscreen[0].effects!.cache).toBeUndefined()
    expect(f.signatures).toHaveLength(0)
  })

  it('passes the invalidation to the renderer', () => {
    const f = frame()
    const { layer } = cached(f)
    f.render()
    layer.invalidate()
    f.render()
    expect(f.offscreen[1].effects!.cache!.invalidated).toBe(true)
  })
})
