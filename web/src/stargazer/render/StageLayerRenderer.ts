// The per-layer node walk: viewport cull, compose the final transform, draw.
// Split out of `Stage` because it is a self-contained loop with its own scratch
// state (the cull-rect corners), independent of `Stage`'s pass dispatch, camera
// resolution, and resize handling.

import type { Affine2x3, CameraView2D } from '../camera/CameraView2D'
import type { Vec2 } from '../math/Vec2'
import type { SceneTree } from '../scene/SceneTree'
import type { RenderLayer, Node2D } from '../scene/Node2D'
import type { Gfx2D } from './gfx/Gfx2D'
import type { Renderer } from './Renderer'
import { isEffectivelyVisible } from '../scene/traverse'
import { hasClipNodes } from '../scene/Node2D'
import { GfxPath } from './gfx/GfxPath'
import type { Rect } from '../math/Rect'
import {
  InsetCameraView,
  InsetViewNode,
  hasInsets,
} from '../nodes/InsetViewNode'

/**
 * World-unit slack on viewport cull, on top of stroke half-width. Covers AA
 * edges and sub-pixel drift so nodes don't pop early at the boundary.
 */
const CULL_AA_PAD_WORLD = 2

/**
 * Walks one render layer's nodes, culls, and draws. Owns the cull-rect scratch
 * buffers so `Stage.render` doesn't allocate a `Vec2` pair per frame.
 */
export class StageLayerRenderer {
  // Scratch for the per-layer viewport-cull bounds, reused each frame.
  readonly #cullTL: Vec2 = { x: 0, y: 0 }
  readonly #cullBR: Vec2 = { x: 0, y: 0 }
  /**
   * One reusable camera view per inset, so drawing inside one allocates
   * nothing.
   */
  readonly #insetViews = new WeakMap<InsetViewNode, InsetCameraView>()
  /** Clip-owning ancestors of the node being drawn, outermost first. */
  readonly #chain: Node2D[] = []
  /** The clips currently pushed, outermost first. */
  readonly #active: Node2D[] = []
  /** Cached path of a node whose clip is a rect. */
  readonly #rectPaths = new WeakMap<
    Node2D,
    { path: GfxPath; x: number; y: number; w: number; h: number }
  >()

  drawLayer(
    scene: SceneTree,
    renderer: Renderer,
    layer: RenderLayer,
    gfx: Gfx2D,
    camera: CameraView2D,
    // Device-pixel base affine (DPR · camera screen affine). May carry rotation
    // / skew from a transformed or parented camera, so it's a full 2×3.
    render: Affine2x3,
    dt: number,
  ): void {
    const marks = scene.engine?.perfMarks ?? false
    // Cull rect from the canvas corners (not the camera viewport) so it
    // includes letterbox margins, otherwise content still on screen in the
    // uncovered axis clips.
    const cssW = renderer.cssSize.w
    const cssH = renderer.cssSize.h
    camera.screenToWorld(0, 0, this.#cullTL)
    camera.screenToWorld(cssW, cssH, this.#cullBR)
    const visLeft = Math.min(this.#cullTL.x, this.#cullBR.x)
    const visRight = Math.max(this.#cullTL.x, this.#cullBR.x)
    const visTop = Math.min(this.#cullTL.y, this.#cullBR.y)
    const visBottom = Math.max(this.#cullTL.y, this.#cullBR.y)
    const strokeScale = camera.strokeSpaceScale()

    const layerNodes = scene.getLayerNodes(layer)
    const anyInsets = hasInsets(scene)
    const anyClips = hasClipNodes()
    for (let i = 0; i < layerNodes.length; i++) {
      const node = layerNodes[i]
      if (!isEffectivelyVisible(node)) continue
      if (!node.draw) continue
      // Skip nodes whose bounds are fully outside the visible rect. Only nodes
      // that declare `debugBounds` can be culled, the rest always draw.
      if (
        node.debugBounds &&
        this.#isOutsideView(
          node,
          strokeScale,
          visLeft,
          visRight,
          visTop,
          visBottom,
        )
      ) {
        continue
      }
      if (anyClips || this.#active.length > 0) {
        this.#syncClips(node, anyClips, gfx, render)
      }
      // A node inside an inset draws clipped to the inset's rounded rect and
      // sees the inset's camera, so its screen-space strokes keep their size.
      const inset = anyInsets ? insetAncestor(node) : null
      let view = camera
      if (inset) {
        setFinalTransform(gfx, render, inset.transform.world)
        gfx.setClip({
          kind: 'roundRect',
          x: 0,
          y: 0,
          w: inset.width,
          h: inset.height,
          radius: inset.radius,
        })
        let insetView = this.#insetViews.get(inset)
        if (!insetView) {
          insetView = new InsetCameraView()
          this.#insetViews.set(inset, insetView)
        }
        view = insetView.bind(camera, inset)
      }
      const w = node.transform.world
      // final = render · node.world (full 2×3 matmul, the camera affine may be
      // rotated/skewed via a transformed or parented camera). For an identity
      // camera `render` is uniform-scale + translate, so this reduces to the old
      // `scaleDpr * w.* (+ off)` fast path with identical numbers.
      const fA = render.a * w.a + render.c * w.b
      const fB = render.b * w.a + render.d * w.b
      const fC = render.a * w.c + render.c * w.d
      const fD = render.b * w.c + render.d * w.d
      const fE = render.a * w.e + render.c * w.f + render.e
      const fF = render.b * w.e + render.d * w.f + render.f
      gfx.setBaseTransform(fA, fB, fC, fD, fE, fF)
      gfx.setAlpha(node.transform.alpha)
      const id = marks ? node.id : ''
      const startMark = marks ? `draw-${id}:start` : ''
      if (marks) performance.mark(startMark)
      node.draw(gfx, view, dt)
      if (inset) gfx.setClip(null)
      if (marks) {
        const endMark = `draw-${id}:end`
        performance.mark(endMark)
        performance.measure(`draw ${id}`, startMark, endMark)
      }
    }
    this.#syncClips(null, false, gfx, render)
    gfx.setAlpha(1)
  }

  /**
   * Make the pushed clips match the clip ancestors of `node` (none when `node`
   * is null). Clips shared with the previous node stay, the rest are popped and
   * the new ones pushed.
   */
  #syncClips(
    node: Node2D | null,
    collect: boolean,
    gfx: Gfx2D,
    render: Affine2x3,
  ): void {
    const chain = this.#chain
    chain.length = 0
    if (node && collect) {
      for (let n: Node2D | null = node; n; n = parent2D(n)) {
        if (n.clip) chain.push(n)
      }
      chain.reverse()
    }
    const active = this.#active
    let k = 0
    while (k < active.length && k < chain.length && active[k] === chain[k]) k++
    while (active.length > k) {
      active.pop()
      gfx.restore()
    }
    for (let j = k; j < chain.length; j++) {
      const owner = chain[j]
      gfx.save()
      setFinalTransform(gfx, render, owner.transform.world)
      gfx.clipPath(this.#clipPathOf(owner))
      active.push(owner)
    }
  }

  /** The owner's clip as a path, building and caching one for a rect. */
  #clipPathOf(owner: Node2D): GfxPath {
    const clip = owner.clip as GfxPath | Rect
    if (clip instanceof GfxPath) return clip
    let cached = this.#rectPaths.get(owner)
    if (!cached) {
      cached = { path: new GfxPath(), x: NaN, y: 0, w: 0, h: 0 }
      this.#rectPaths.set(owner, cached)
    }
    if (
      cached.x !== clip.x ||
      cached.y !== clip.y ||
      cached.w !== clip.width ||
      cached.h !== clip.height
    ) {
      cached.x = clip.x
      cached.y = clip.y
      cached.w = clip.width
      cached.h = clip.height
      cached.path
        .clear()
        .moveTo(clip.x, clip.y)
        .lineTo(clip.x + clip.width, clip.y)
        .lineTo(clip.x + clip.width, clip.y + clip.height)
        .lineTo(clip.x, clip.y + clip.height)
        .close()
    }
    return cached.path
  }

  /**
   * True when `node`'s world-space AABB lies fully outside the visible rect
   * (with a stroke + AA margin). The AABB is the node's local `debugBounds`
   * pushed through its world matrix (all four corners, so rotated nodes are
   * handled). The margin adds the node's own stroke half-width. CSS-px strokes
   * convert to world via `strokeScale`, so a state whose FILL is just
   * off-screen doesn't get its visible stroke clipped.
   */
  #isOutsideView(
    node: Node2D,
    strokeScale: number,
    visLeft: number,
    visRight: number,
    visTop: number,
    visBottom: number,
  ): boolean {
    const b = node.debugBounds!
    const w = node.transform.world
    const x0 = b.x
    const y0 = b.y
    const x1 = b.x + b.width
    const y1 = b.y + b.height
    // Four local corners -> world.
    const wx0 = w.a * x0 + w.c * y0 + w.e
    const wy0 = w.b * x0 + w.d * y0 + w.f
    const wx1 = w.a * x1 + w.c * y0 + w.e
    const wy1 = w.b * x1 + w.d * y0 + w.f
    const wx2 = w.a * x1 + w.c * y1 + w.e
    const wy2 = w.b * x1 + w.d * y1 + w.f
    const wx3 = w.a * x0 + w.c * y1 + w.e
    const wy3 = w.b * x0 + w.d * y1 + w.f
    const minX = Math.min(wx0, wx1, wx2, wx3)
    const maxX = Math.max(wx0, wx1, wx2, wx3)
    const minY = Math.min(wy0, wy1, wy2, wy3)
    const maxY = Math.max(wy0, wy1, wy2, wy3)

    // Stroke half-width in world units (0 for non-stroked nodes). Screen-space
    // strokes (the default) scale by `strokeScale`, world-space strokes are
    // already in world units. `cullMargin` (an outside-aligned border, a
    // shadow's offset/blur/spread) follows the same node-space convention and
    // the same conversion, so a `ShapeNode` adds it on top rather than
    // needing its own units.
    const strokeNode = node as {
      lineWidth?: number
      strokeSpace?: string
      cullMargin?: number
    }
    const lw = strokeNode.lineWidth ?? 0
    const extra = strokeNode.cullMargin ?? 0
    const raw = lw * 0.5 + extra
    const worldMargin =
      raw > 0
        ? strokeNode.strokeSpace === 'world'
          ? raw
          : raw * strokeScale
        : 0
    const m = worldMargin + CULL_AA_PAD_WORLD

    return (
      maxX < visLeft - m ||
      minX > visRight + m ||
      maxY < visTop - m ||
      minY > visBottom + m
    )
  }
}

/** The nearest {@link InsetViewNode} above `node`, or `null`. */
function insetAncestor(node: Node2D): InsetViewNode | null {
  let p = node.parent
  while (p) {
    if (p instanceof InsetViewNode) return p
    p = p.parent
  }
  return null
}

/** Set `gfx`'s base transform to `render · world`. */
function setFinalTransform(gfx: Gfx2D, render: Affine2x3, w: DOMMatrix): void {
  gfx.setBaseTransform(
    render.a * w.a + render.c * w.b,
    render.b * w.a + render.d * w.b,
    render.a * w.c + render.c * w.d,
    render.b * w.c + render.d * w.d,
    render.a * w.e + render.c * w.f + render.e,
    render.b * w.e + render.d * w.f + render.f,
  )
}

/** The nearest `Node2D` ancestor, skipping other node kinds. */
function parent2D(n: Node2D): Node2D | null {
  let p = n.parent
  while (p) {
    if ('transform' in p) return p as Node2D
    p = p.parent
  }
  return null
}
