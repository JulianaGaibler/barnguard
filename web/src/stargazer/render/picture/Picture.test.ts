import { afterEach, describe, expect, it, vi } from 'vitest'
import { SceneTree } from '../../scene/SceneTree'
import { Node2D } from '../../scene/Node2D'
import type { Affine2x3, CameraView2D } from '../../camera/CameraView2D'
import type { Rect } from '../../math/Rect'
import { GfxPath } from '../gfx/GfxPath'
import { GpuGfx } from '../gfx/GpuGfx'
import { MockGfxDevice } from '../gfx/webgl2/mockGfxDevice'
import type { Gfx2D } from '../gfx/Gfx2D'
import type { Renderer } from '../Renderer'
import { ComposeWalk } from '../ComposeWalk'
import { Canvas } from './Canvas'
import { definePaintProps } from './paintProps'
import { VersionedRef } from './VersionedRef'

const IDENTITY: Affine2x3 = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }
const renderer = { cssSize: { w: 1000, h: 1000 } } as unknown as Renderer

/**
 * A camera that shows `view` and reports one world unit per CSS pixel times
 * `stroke`.
 */
function makeCamera(view: Rect, stroke = 1): CameraView2D {
  return {
    screenToWorld: (x: number, y: number, out?: { x: number; y: number }) =>
      Object.assign(out ?? { x: 0, y: 0 }, { x, y }),
    strokeSpaceScale: () => stroke,
    visibleWorldRect: () => view,
    getScreenAffine: () => IDENTITY,
  } as unknown as CameraView2D
}

/** A walk without the staleness checker, whose extra paints would skew counts. */
function makeWalk(): ComposeWalk {
  const walk = new ComposeWalk()
  walk.stalenessSamples = 0
  return walk
}

const WIDE: Rect = { x: 0, y: 0, width: 1000, height: 1000 }

/** A fake `Gfx2D` that logs the calls a node's drawing makes. */
function logGfx(offscreen = true): {
  gfx: Gfx2D
  log: unknown[][]
} {
  const log: unknown[][] = []
  let alpha = 1
  let handles = 0
  const stack: number[] = []
  const gfx = new Proxy(
    {},
    {
      get(_t, name: string) {
        if (name === 'getAlpha') return () => alpha
        return (...args: unknown[]) => {
          if (name === 'setAlpha') alpha = args[0] as number
          if (name === 'save') stack.push(alpha)
          if (name === 'restore') alpha = stack.pop() ?? alpha
          log.push([name, ...args])
          if (name === 'beginOffscreen') return offscreen
          if (name === 'endOffscreen') return { handle: ++handles }
        }
      },
    },
  ) as Gfx2D
  return { gfx, log }
}

/** Draws through the compose walk and returns the walk for its counters. */
function drawFrame(
  scene: SceneTree,
  walk: ComposeWalk,
  gfx: Gfx2D,
  opts: { camera?: CameraView2D; render?: Affine2x3 } = {},
): void {
  scene.updateTransforms()
  walk.draw(
    scene,
    renderer,
    gfx,
    opts.camera ?? makeCamera(WIDE),
    opts.render ?? IDENTITY,
    0,
  )
}

class Painter extends Node2D {
  paints = 0
  readonly body: (c: Canvas) => void
  constructor(
    body: (c: Canvas) => void = (c) => c.fillRect(0, 0, 10, 10, '#f00'),
  ) {
    super()
    this.body = body
  }
  override paint(canvas: Canvas): void {
    this.paints++
    this.body(canvas)
  }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('replay', () => {
  it('re-issues the recorded calls under the node alpha, and undoes its state', () => {
    const scene = new SceneTree()
    const parent = new Node2D()
    parent.transform.alpha = 0.5
    const node = new Painter((c) => {
      c.setAlpha(0.5)
      c.translate(3, 4)
      c.fillRect(0, 0, 10, 10, '#f00')
    })
    parent.add(node)
    scene.root.add(parent)
    const { gfx, log } = logGfx()
    drawFrame(scene, makeWalk(), gfx)
    const names = log.map((l) => l[0])
    expect(names).toEqual([
      'setBaseTransform',
      'setAlpha',
      'save',
      'setAlpha',
      'translate',
      'fillRect',
      'restore',
      'setAlpha',
    ])
    // The node's own alpha cascades to 0.5, and `setAlpha(0.5)` inside the
    // picture is relative to it.
    expect(log[3]).toEqual(['setAlpha', 0.25])
  })

  it('copies its arguments, so a scratch array changed later does not change it', () => {
    const pts = new Float32Array([0, 0, 10, 0, 10, 10])
    const scene = new SceneTree()
    scene.root.add(new Painter((c) => c.fillConvexPoly(pts, 3, '#0f0')))
    pts.fill(99)
    const walk = makeWalk()
    const { gfx, log } = logGfx()
    drawFrame(scene, walk, gfx)
    // The picture was painted before `pts` was overwritten above? No: paint runs
    // in the frame, after. So this checks the copy through a second frame.
    pts.fill(7)
    log.length = 0
    drawFrame(scene, walk, gfx)
    const call = log.find((l) => l[0] === 'fillConvexPoly')!
    expect(Array.from(call[1] as Float32Array)).toEqual([
      99, 99, 99, 99, 99, 99,
    ])
  })

  it('resolves a screen-space stroke width at the camera scale in effect', () => {
    const scene = new SceneTree()
    scene.root.add(
      new Painter((c) =>
        c.strokeLine(0, 0, 10, 0, { color: '#fff', width: { screen: 2 } }),
      ),
    )
    const walk = makeWalk()
    const a = logGfx()
    drawFrame(scene, walk, a.gfx, { camera: makeCamera(WIDE, 1) })
    const b = logGfx()
    drawFrame(scene, walk, b.gfx, { camera: makeCamera(WIDE, 3) })
    const width = (l: unknown[][]) =>
      (l.find((c) => c[0] === 'strokeLine')![5] as { width: number }).width
    expect(width(a.log)).toBe(2)
    expect(width(b.log)).toBe(6)
  })
})

/** What the frame did to a device: its draw calls and the bytes they read. */
async function deviceFrame(
  build: (scene: SceneTree) => void,
): Promise<{ kinds: string[]; bytes: number[][] }> {
  const canvas = document.createElement('canvas')
  canvas.width = 400
  canvas.height = 300
  const device = new MockGfxDevice()
  const gfx = new GpuGfx(canvas, device, { stencil: true, samples: 1 })
  await gfx.whenReady
  const scene = new SceneTree()
  build(scene)
  scene.updateTransforms()
  gfx.beginFrame({
    clearColor: '#000000',
    transparent: false,
    pixelW: 400,
    pixelH: 300,
  })
  makeWalk().draw(scene, renderer, gfx, makeCamera(WIDE, 1.5), IDENTITY, 0)
  gfx.endFrame()
  return {
    kinds: device.draws.map((d) => `${d.kind}:${d.count}`),
    bytes: device.draws.map((d) =>
      d.bufferSnapshot ? Array.from(new Uint8Array(d.bufferSnapshot)) : [],
    ),
  }
}

describe('equivalence with drawing directly', () => {
  it('gives the same draws and instance bytes as the same calls made in draw', async () => {
    const shapes = (g: {
      fillRect: Gfx2D['fillRect']
      fillRoundRect: Gfx2D['fillRoundRect']
      fillCircle: Gfx2D['fillCircle']
      strokeLine: Gfx2D['strokeLine']
      translate: Gfx2D['translate']
      save: Gfx2D['save']
      restore: Gfx2D['restore']
      fillConvexPoly: Gfx2D['fillConvexPoly']
    }) => {
      g.fillRect(0, 0, 40, 20, '#336699')
      g.save()
      g.translate(60, 10)
      g.fillRoundRect(0, 0, 50, 30, 6, '#ccaa33')
      g.fillCircle(80, 10, 9, 'rgba(255,0,0,0.5)')
      g.restore()
      g.strokeLine(5, 90, 120, 95, { color: '#ffffff', width: 3 })
      g.fillConvexPoly(
        new Float32Array([0, 150, 30, 150, 15, 180]),
        3,
        '#00cc88',
      )
    }
    class Immediate extends Node2D {
      override draw(gfx: Gfx2D): void {
        shapes(gfx)
      }
    }
    const direct = await deviceFrame((s) => {
      const n = new Immediate()
      n.transform.x = 20
      n.transform.y = 10
      s.root.add(n)
    })
    const recorded = await deviceFrame((s) => {
      const n = new Painter((c) => shapes(c))
      n.transform.x = 20
      n.transform.y = 10
      s.root.add(n)
    })
    expect(recorded.kinds.length).toBeGreaterThan(0)
    expect(recorded).toEqual(direct)
  })

  it('draws a screen-space width like the width the node worked out itself', async () => {
    class Immediate extends Node2D {
      override draw(gfx: Gfx2D, camera: CameraView2D): void {
        gfx.strokeLine(0, 0, 100, 0, {
          color: '#fff',
          width: 2 * camera.strokeSpaceScale(),
        })
      }
    }
    const direct = await deviceFrame((s) => s.root.add(new Immediate()))
    const recorded = await deviceFrame((s) =>
      s.root.add(
        new Painter((c) =>
          c.strokeLine(0, 0, 100, 0, { color: '#fff', width: { screen: 2 } }),
        ),
      ),
    )
    expect(recorded).toEqual(direct)
  })
})

describe('repainting', () => {
  it('paints once and replays after that', () => {
    const scene = new SceneTree()
    const node = new Painter()
    scene.root.add(node)
    const walk = makeWalk()
    const { gfx } = logGfx()
    drawFrame(scene, walk, gfx)
    drawFrame(scene, walk, gfx)
    drawFrame(scene, walk, gfx)
    expect(node.paints).toBe(1)
    expect(walk.stats).toMatchObject({ paints: 0, replays: 1 })
  })

  it('repaints after markNeedsPaint, once', () => {
    const scene = new SceneTree()
    const node = new Painter()
    scene.root.add(node)
    const walk = makeWalk()
    const { gfx } = logGfx()
    drawFrame(scene, walk, gfx)
    node.markNeedsPaint()
    drawFrame(scene, walk, gfx)
    drawFrame(scene, walk, gfx)
    expect(node.paints).toBe(2)
  })

  it('does not repaint when its transform or alpha moves', () => {
    const scene = new SceneTree()
    const node = new Painter()
    scene.root.add(node)
    const walk = makeWalk()
    const { gfx } = logGfx()
    drawFrame(scene, walk, gfx)
    node.transform.x = 50
    node.transform.alpha = 0.3
    drawFrame(scene, walk, gfx)
    expect(node.paints).toBe(1)
  })

  it('refuses markNeedsPaint on another node while painting', () => {
    const scene = new SceneTree()
    const other = new Painter()
    scene.root.add(other)
    scene.root.add(new Painter(() => other.markNeedsPaint()))
    expect(() => drawFrame(scene, makeWalk(), logGfx().gfx)).toThrow(
      /paint must not dirty a node/,
    )
  })
})

describe('paint properties', () => {
  class Eye extends Node2D {
    declare openAmount: number
    paints = 0
    constructor() {
      super()
      definePaintProps(this, { openAmount: 1 })
    }
    override paint(c: Canvas): void {
      this.paints++
      c.fillCircle(0, 0, 10 * this.openAmount, '#fff')
    }
  }

  it('repaint the node when the value changes, and not when it is written equal', () => {
    const scene = new SceneTree()
    const eye = new Eye()
    scene.root.add(eye)
    const walk = makeWalk()
    const { gfx } = logGfx()
    drawFrame(scene, walk, gfx)
    eye.openAmount = 1
    drawFrame(scene, walk, gfx)
    expect(eye.paints).toBe(1)
    eye.openAmount = 0.5
    drawFrame(scene, walk, gfx)
    expect(eye.paints).toBe(2)
    expect(eye.openAmount).toBe(0.5)
  })

  it('keep their values per instance', () => {
    const a = new Eye()
    const b = new Eye()
    a.openAmount = 0.2
    expect(b.openAmount).toBe(1)
  })

  it('throw in development when a class field hides the accessor', () => {
    class Hidden extends Node2D {
      openAmount = 1
      constructor() {
        super()
        definePaintProps(this, { openAmount: 1 })
      }
    }
    expect(() => new Hidden()).toThrow(/own property/)
  })
})

describe('versioned resources', () => {
  it('repaint only the nodes that drew from them, after a touch', () => {
    const scene = new SceneTree()
    const grid = new VersionedRef([0, 0])
    const user = new Painter((c) => {
      c.use(grid)
      c.fillRect(0, 0, 5, 5, '#fff')
    })
    const bystander = new Painter()
    scene.root.add(user, bystander)
    const walk = makeWalk()
    const { gfx } = logGfx()
    drawFrame(scene, walk, gfx)
    grid.value[0] = 1
    grid.touch()
    drawFrame(scene, walk, gfx)
    expect(user.paints).toBe(2)
    expect(bystander.paints).toBe(1)
  })

  it('repaint a node after an edit to a path it filled', () => {
    const scene = new SceneTree()
    const path = new GfxPath().moveTo(0, 0).lineTo(10, 0).lineTo(10, 10).close()
    const node = new Painter((c) => c.fillPath(path, '#fff'))
    scene.root.add(node)
    const walk = makeWalk()
    const { gfx } = logGfx()
    drawFrame(scene, walk, gfx)
    path.lineTo(0, 10)
    drawFrame(scene, walk, gfx)
    expect(node.paints).toBe(2)
  })
})

describe('engine invalidation', () => {
  it('redraws a scale-dependent picture once the scale stops at another value', () => {
    const scene = new SceneTree()
    const node = new Painter((c) => {
      c.fillRect(0, 0, c.snap(10.4), 10, '#fff')
    })
    scene.root.add(node)
    const walk = makeWalk()
    const { gfx } = logGfx()
    const at = (s: number): Affine2x3 => ({ ...IDENTITY, a: s, d: s })
    drawFrame(scene, walk, gfx, { render: at(1) })
    // The scale moves, so the picture keeps its snapped lengths and the quad scales.
    drawFrame(scene, walk, gfx, { render: at(4) })
    expect(node.paints).toBe(1)
    // One frame after it stopped, the picture is drawn again for the new scale.
    drawFrame(scene, walk, gfx, { render: at(4) })
    expect(node.paints).toBe(2)
    drawFrame(scene, walk, gfx, { render: at(4) })
    expect(node.paints).toBe(2)
  })

  it('leaves a picture that does not depend on scale alone when the scale changes', () => {
    const scene = new SceneTree()
    const node = new Painter()
    scene.root.add(node)
    const walk = makeWalk()
    const { gfx } = logGfx()
    const at = (s: number): Affine2x3 => ({ ...IDENTITY, a: s, d: s })
    drawFrame(scene, walk, gfx, { render: at(1) })
    drawFrame(scene, walk, gfx, { render: at(4) })
    drawFrame(scene, walk, gfx, { render: at(4) })
    expect(node.paints).toBe(1)
  })

  it('redraws a picture that read the camera when the view changes', () => {
    const scene = new SceneTree()
    const node = new Painter((c) => {
      const r = c.visibleWorldRect()
      c.fillRect(r.x, r.y, r.width, r.height, '#123')
    })
    scene.root.add(node)
    const walk = makeWalk()
    const { gfx } = logGfx()
    drawFrame(scene, walk, gfx, { camera: makeCamera(WIDE) })
    drawFrame(scene, walk, gfx, { camera: makeCamera(WIDE) })
    expect(node.paints).toBe(1)
    drawFrame(scene, walk, gfx, {
      camera: makeCamera({ x: 10, y: 0, width: 1000, height: 1000 }),
    })
    expect(node.paints).toBe(2)
  })
})

describe('screen scale', () => {
  it('repaints when the world size of a CSS pixel changes, and not otherwise', () => {
    const scene = new SceneTree()
    const node = new Painter((c) => {
      const s = c.screenScale()
      c.fillRect(0, 0, 10 * s, 10 * s, '#fff')
    })
    scene.root.add(node)
    const walk = makeWalk()
    const { gfx } = logGfx()
    drawFrame(scene, walk, gfx, { camera: makeCamera(WIDE, 1) })
    drawFrame(scene, walk, gfx, { camera: makeCamera(WIDE, 1) })
    expect(node.paints).toBe(1)
    drawFrame(scene, walk, gfx, { camera: makeCamera(WIDE, 2) })
    expect(node.paints).toBe(2)
  })
})

describe('bounds', () => {
  it('culls a picture that lies outside the view and draws one inside it', () => {
    const scene = new SceneTree()
    const inside = new Painter((c) => c.fillRect(0, 0, 10, 10, '#fff'))
    const outside = new Painter((c) => c.fillRect(0, 0, 10, 10, '#fff'))
    outside.transform.x = 5000
    scene.root.add(inside, outside)
    const walk = makeWalk()
    drawFrame(scene, walk, logGfx().gfx)
    expect(walk.stats).toMatchObject({ replays: 1, culled: 1 })
  })

  it('checks the versions of a culled node, so it is current when it returns', () => {
    const scene = new SceneTree()
    const grid = new VersionedRef([0])
    const node = new Painter((c) => {
      c.use(grid)
      c.fillRect(0, 0, 10, 10, '#fff')
    })
    node.transform.x = 5000
    scene.root.add(node)
    const walk = makeWalk()
    const { gfx } = logGfx()
    drawFrame(scene, walk, gfx)
    expect(walk.stats).toMatchObject({ paints: 1, culled: 1, replays: 0 })
    grid.touch()
    drawFrame(scene, walk, gfx)
    expect(node.paints).toBe(2)
    node.transform.x = 0
    drawFrame(scene, walk, gfx)
    expect(node.paints).toBe(2)
    expect(walk.stats).toMatchObject({ paints: 0, replays: 1, culled: 0 })
  })

  it('does not cull a stroke whose screen-space width reaches into view', () => {
    const scene = new SceneTree()
    const node = new Painter((c) =>
      c.strokeLine(0, 0, 0, 100, { color: '#fff', width: { screen: 40 } }),
    )
    // The line sits 10 world units left of the view, and its stroke is 20 wide.
    node.transform.x = -10
    scene.root.add(node)
    const walk = makeWalk()
    drawFrame(scene, walk, logGfx().gfx)
    expect(walk.stats.culled).toBe(0)
  })

  it('takes bounds from the picture, and boundsOverride replaces them', () => {
    const node = new Painter((c) => c.fillRect(2, 3, 10, 20, '#fff'))
    expect(node.bounds).toBeNull()
    const scene = new SceneTree()
    scene.root.add(node)
    drawFrame(scene, makeWalk(), logGfx().gfx)
    expect(node.bounds).toEqual({ x: 2, y: 3, width: 10, height: 20 })
    node.boundsOverride = { x: 0, y: 0, width: 5, height: 5 }
    expect(node.bounds).toEqual({ x: 0, y: 0, width: 5, height: 5 })
  })

  it('does not cull a node whose override is outside the view while its picture shows', () => {
    const node = new Painter((c) => c.fillRect(0, 0, 100, 100, '#fff'))
    node.boundsOverride = { x: -500, y: -500, width: 10, height: 10 }
    const scene = new SceneTree()
    scene.root.add(node)
    const walk = makeWalk()
    drawFrame(scene, walk, logGfx().gfx)
    expect(walk.stats.culled).toBe(0)
  })

  it('hit tests against the picture bounds', () => {
    const node = new Painter((c) => c.fillRect(0, 0, 10, 10, '#fff'))
    const scene = new SceneTree()
    scene.root.add(node)
    drawFrame(scene, makeWalk(), logGfx().gfx)
    expect(node.hitTest(5, 5, 0)).toBe(true)
    expect(node.hitTest(50, 50, 0)).toBe(false)
  })

  it('applies the current transform to what is drawn after a translate', () => {
    const node = new Painter((c) => {
      c.save()
      c.translate(100, 0)
      c.scale(2, 2)
      c.fillRect(0, 0, 10, 10, '#fff')
      c.restore()
      c.fillRect(0, 0, 1, 1, '#fff')
    })
    const scene = new SceneTree()
    scene.root.add(node)
    drawFrame(scene, makeWalk(), logGfx().gfx)
    expect(node.bounds).toEqual({ x: 0, y: 0, width: 120, height: 20 })
  })
})

describe('pixelSnap', () => {
  it('rounds the origin to a whole device pixel without repainting', () => {
    const scene = new SceneTree()
    const node = new Painter()
    node.pixelSnap = true
    node.transform.x = 10.4
    node.transform.y = 20.6
    scene.root.add(node)
    const walk = makeWalk()
    const { gfx, log } = logGfx()
    drawFrame(scene, walk, gfx)
    const base = (l: unknown[][]) => l.find((c) => c[0] === 'setBaseTransform')!
    expect(base(log).slice(5)).toEqual([10, 21])
    node.transform.x = 11.2
    log.length = 0
    drawFrame(scene, walk, gfx)
    expect(base(log).slice(5)).toEqual([11, 21])
    expect(node.paints).toBe(1)
  })
})

describe('staleness checker', () => {
  it('reports a picture that changed without being marked, once', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    let width = 10
    const node = new Painter((c) => c.fillRect(0, 0, width, 10, '#fff'))
    const scene = new SceneTree()
    scene.root.add(node)
    const walk = new ComposeWalk()
    walk.stalenessSamples = 4
    const { gfx } = logGfx()
    drawFrame(scene, walk, gfx)
    drawFrame(scene, walk, gfx)
    expect(warn).not.toHaveBeenCalled()
    width = 20
    drawFrame(scene, walk, gfx)
    drawFrame(scene, walk, gfx)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0][0]).toMatch(/stale picture/)
  })

  it('stays quiet for a picture that is up to date', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const scene = new SceneTree()
    scene.root.add(new Painter(), new Painter())
    const walk = new ComposeWalk()
    walk.stalenessSamples = 4
    const { gfx } = logGfx()
    for (let i = 0; i < 5; i++) drawFrame(scene, walk, gfx)
    expect(warn).not.toHaveBeenCalled()
  })
})

describe('compositeGroup', () => {
  function group(): { scene: SceneTree; root: Node2D; kids: Painter[] } {
    const scene = new SceneTree()
    const root = new Node2D()
    root.transform.alpha = 0.5
    root.compositeGroup = true
    const kids = [
      new Painter((c) => c.fillRect(10, 10, 20, 20, '#f00')),
      new Painter((c) => c.fillRect(40, 10, 20, 20, '#0f0')),
    ]
    root.add(...kids)
    scene.root.add(root)
    return { scene, root, kids }
  }

  const names = (log: unknown[][]): unknown[] => log.map((e) => e[0])

  it('draws the subtree into a surface and composites it with the node alpha', () => {
    const { scene, root } = group()
    const { gfx, log } = logGfx()
    drawFrame(scene, new ComposeWalk(), gfx)
    const begin = log.find((e) => e[0] === 'beginOffscreen')![1] as {
      opacity: number
      bounds: Rect
    }
    expect(begin.opacity).toBe(0.5)
    expect(begin.bounds.x).toBeLessThanOrEqual(10)
    expect(begin.bounds.x + begin.bounds.width).toBeGreaterThanOrEqual(60)
    const order = names(log)
    expect(order.indexOf('beginOffscreen')).toBeLessThan(
      order.indexOf('fillRect'),
    )
    expect(order.lastIndexOf('fillRect')).toBeLessThan(
      order.indexOf('endOffscreen'),
    )
    // The surface opens from full alpha, and inside it each drawing is at full
    // opacity.
    const alphas = log.filter((e) => e[0] === 'setAlpha').map((e) => e[1])
    expect(alphas.every((a) => a === 1)).toBe(true)
    root.destroy()
  })

  it('paints each picture once although the bounds pass visits it first', () => {
    const { scene, root, kids } = group()
    drawFrame(scene, new ComposeWalk(), logGfx().gfx)
    expect(kids.map((k) => k.paints)).toEqual([1, 1])
    root.destroy()
  })

  it('draws with per-drawing alpha where a surface is unavailable', () => {
    const { scene, root } = group()
    const { gfx, log } = logGfx(false)
    drawFrame(scene, new ComposeWalk(), gfx)
    expect(names(log)).not.toContain('endOffscreen')
    const alphas = log.filter((e) => e[0] === 'setAlpha').map((e) => e[1])
    expect(alphas).toContain(0.5)
    root.destroy()
  })
})

describe('compositeBlend and matte', () => {
  const names = (log: unknown[][]): unknown[] => log.map((e) => e[0])

  it('composites a blended node as a group with its blend', () => {
    const scene = new SceneTree()
    const node = new Painter((c) => c.fillRect(0, 0, 20, 20, '#f00'))
    node.compositeBlend = 'multiply'
    scene.root.add(node)
    const { gfx, log } = logGfx()
    drawFrame(scene, new ComposeWalk(), gfx)
    const begin = log.find((e) => e[0] === 'beginOffscreen')![1] as {
      blend: string
    }
    expect(begin.blend).toBe('multiply')
    expect(names(log)).toContain('endOffscreen')
    node.destroy()
  })

  it('draws the node and its matte into surfaces over the same area', () => {
    const scene = new SceneTree()
    const content = new Painter((c) => c.fillRect(0, 0, 40, 40, '#f00'))
    const cover = new Painter((c) => c.fillRect(10, 10, 20, 20, '#0f0'))
    content.matte = cover
    content.matteMode = 'inverted-luma'
    content.transform.alpha = 0.5
    scene.root.add(content, cover)
    const { gfx, log } = logGfx()
    drawFrame(scene, new ComposeWalk(), gfx)
    const order = names(log)
    expect(order.filter((n) => n === 'beginOffscreen')).toHaveLength(2)
    expect(order.filter((n) => n === 'fillRect')).toHaveLength(2)
    // The node's content comes first, then the matte's, then the composite.
    const fills = log.filter((e) => e[0] === 'fillRect')
    expect(fills[0][5]).toBe('#f00')
    expect(fills[1][5]).toBe('#0f0')
    expect(order.indexOf('drawOffscreen')).toBeGreaterThan(
      order.lastIndexOf('endOffscreen') - 1,
    )
    const begins = log
      .filter((e) => e[0] === 'beginOffscreen')
      .map((e) => e[1] as { bounds: Rect; retain: boolean })
    expect(begins.every((b) => b.retain)).toBe(true)
    expect(begins[1].bounds).toEqual(begins[0].bounds)
    const composite = log.find((e) => e[0] === 'drawOffscreen')![2] as {
      opacity: number
      matte: unknown
      matteMode: string
    }
    expect(composite.opacity).toBe(0.5)
    expect(composite.matte).toBeDefined()
    expect(composite.matteMode).toBe('inverted-luma')
    content.destroy()
    cover.destroy()
  })

  it('keeps a matte out of the normal walk', () => {
    const scene = new SceneTree()
    const content = new Painter((c) => c.fillRect(0, 0, 40, 40, '#f00'))
    const cover = new Painter((c) => c.fillRect(10, 10, 20, 20, '#0f0'))
    content.matte = cover
    scene.root.add(content, cover)
    const { gfx, log } = logGfx(false)
    drawFrame(scene, new ComposeWalk(), gfx)
    // Without surfaces the node draws plain and the matte is not drawn.
    expect(log.filter((e) => e[0] === 'fillRect')).toHaveLength(1)
    content.destroy()
    cover.destroy()
  })

  it('treats a hidden matte as an empty one', () => {
    const scene = new SceneTree()
    const content = new Painter((c) => c.fillRect(0, 0, 40, 40, '#f00'))
    const cover = new Painter((c) => c.fillRect(10, 10, 20, 20, '#0f0'))
    cover.visible = false
    content.matte = cover
    scene.root.add(content, cover)
    const { gfx, log } = logGfx()
    drawFrame(scene, new ComposeWalk(), gfx)
    expect(log.filter((e) => e[0] === 'fillRect')).toHaveLength(1)
    expect(log.filter((e) => e[0] === 'drawOffscreen')).toHaveLength(1)
    content.destroy()
    cover.destroy()
  })

  it('lets go of the matte it had', () => {
    const a = new Node2D()
    const b = new Node2D()
    const c = new Node2D()
    a.matte = b
    expect(b._matteOf).toBe(a)
    a.matte = c
    expect(b._matteOf).toBeNull()
    expect(c._matteOf).toBe(a)
  })
})

describe('kept strokes', () => {
  const POINTS = new Float32Array(800).map((_, i) =>
    i % 2 ? 100 + Math.sin(i / 20) * 20 : i / 2,
  )

  async function frames(repaint: boolean, count: number): Promise<GpuGfx> {
    const canvas = document.createElement('canvas')
    canvas.width = 400
    canvas.height = 300
    const device = new MockGfxDevice()
    const gfx = new GpuGfx(canvas, device, { stencil: true, samples: 1 })
    await gfx.whenReady
    const scene = new SceneTree()
    const node = new Painter((c) =>
      c.strokePolyline(POINTS, 400, { color: '#ffffff', width: 2 }),
    )
    scene.root.add(node)
    const walk = makeWalk()
    for (let i = 0; i < count; i++) {
      if (repaint) node.markNeedsPaint()
      scene.updateTransforms()
      gfx.beginFrame({
        clearColor: '#000000',
        transparent: false,
        pixelW: 400,
        pixelH: 300,
      })
      walk.draw(scene, renderer, gfx, makeCamera(WIDE), IDENTITY, 0)
      gfx.endFrame()
    }
    return gfx
  }

  it('keeps the stroke of a picture at rest', async () => {
    const gfx = await frames(false, 4)
    expect(gfx.cacheStats()[0].entries).toBe(1)
    expect(gfx.stats.strokeInstances).toBe(0)
  })

  it('keeps nothing for a picture that repaints every frame', async () => {
    const gfx = await frames(true, 6)
    expect(gfx.cacheStats()[0].entries).toBe(0)
    expect(gfx.stats.strokeInstances).toBeGreaterThan(300)
  })
})
