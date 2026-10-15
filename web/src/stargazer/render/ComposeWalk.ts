// The 2D compose walk: one pass over the tree in painter order that culls,
// cascades alpha, applies subtree clips, insets and layer spaces, composes the
// final transform and draws. Split out of `Stage` because it is a self-contained walk with its
// own scratch state, independent of `Stage`'s pass dispatch, camera resolution,
// and resize handling.

import type { Affine2x3, CameraView2D } from '../camera/CameraView2D'
import type { Vec2 } from '../math/Vec2'
import type { SceneTree } from '../scene/SceneTree'
import type { Node } from '../scene/Node'
import type { Node2D } from '../scene/Node2D'
import { Layer } from '../scene/Layer'
import { deviceBoundsOfRect, padBox, type DeviceBox } from './layer/layerBox'
import { LayerSignature, hashString, nodeKey } from './layer/LayerSignature'
import { Copy } from './postfx/effects/Copy'
import type { PostEffect } from './postfx/PostEffect'
import type { Gfx2D } from './gfx/Gfx2D'
import type { Renderer } from './Renderer'
import { GfxPath } from './gfx/GfxPath'
import type { Rect } from '../math/Rect'
import { InsetCameraView, InsetViewNode } from '../nodes/InsetViewNode'
import { Canvas } from './picture/Canvas'
import { Op, Picture } from './picture/Picture'
import { beginPaint, endPaint } from './picture/paintState'

/**
 * World-unit slack on viewport cull, on top of stroke half-width. Covers AA
 * edges and sub-pixel drift so nodes don't pop early at the boundary.
 */
const CULL_AA_PAD_WORLD = 2

/** A device scale this close to last frame's counts as at rest. */
const AT_REST_EPSILON = 1e-3

/** The op names, for a staleness report. */
const OP_NAMES = Object.fromEntries(
  Object.entries(Op).map(([name, code]) => [code, name]),
)

/** The analytic clip a rectangle clip owner sets, in the owner's local space. */
interface RectClip {
  kind: 'roundRect'
  x: number
  y: number
  w: number
  h: number
  radius: number
}

/** What `#enterSpace` replaces in the frame, kept to put back. */
interface SavedSpace {
  render: Affine2x3
  camera: CameraView2D
  strokeScale: number
  visLeft: number
  visRight: number
  visTop: number
  visBottom: number
}

/** Per-frame inputs shared by every node of one walk. */
interface WalkFrame {
  gfx: Gfx2D
  camera: CameraView2D
  render: Affine2x3
  /** Device pixels per CSS pixel, and the canvas size in CSS pixels. */
  dpr: number
  cssW: number
  cssH: number
  dt: number
  marks: boolean
  strokeScale: number
  visLeft: number
  visRight: number
  visTop: number
  visBottom: number
}

/**
 * Walks the tree in painter order, culls, and draws. Owns the scratch buffers
 * so `Stage.render` doesn't allocate per frame.
 *
 * @remarks
 *   Painter order is tree order: a node draws before its children, and siblings
 *   draw in the order they were added. Hidden subtrees are skipped whole. A
 *   node's alpha multiplies into its descendants'. A node with a `clip` clips
 *   itself and everything under it, and an `InsetViewNode` clips and re-frames
 *   what is under it.
 *
 *   A `Layer` with a space of its own swaps the frame's render affine, camera,
 *   stroke scale and cull rect for its view while its subtree is walked, then
 *   puts them back. Everything below it, including pictures, culling, group
 *   boxes and insets, reads the frame, so it follows the swap without knowing
 *   about layers. The walk syncs the layer's view to the canvas as it enters.
 */
export class ComposeWalk {
  // Scratch for the viewport-cull bounds, reused each frame.
  readonly #cullTL: Vec2 = { x: 0, y: 0 }
  readonly #cullBR: Vec2 = { x: 0, y: 0 }
  /**
   * One reusable camera view per inset, so drawing inside one allocates
   * nothing.
   */
  readonly #insetViews = new WeakMap<InsetViewNode, InsetCameraView>()
  /** Cached path of a node whose clip is a rect. */
  readonly #rectPaths = new WeakMap<
    Node2D,
    { path: GfxPath; x: number; y: number; w: number; h: number }
  >()

  /**
   * Draw every visible 2D node of `scene` in tree order. `render` is the
   * device-pixel base affine (DPR times the camera's screen affine), which may
   * carry rotation or skew from a transformed or parented camera, so it is a
   * full 2×3.
   */
  draw(
    scene: SceneTree,
    renderer: Renderer,
    gfx: Gfx2D,
    camera: CameraView2D,
    render: Affine2x3,
    dt: number,
  ): void {
    const frame = this.#frame
    frame.gfx = gfx
    frame.camera = camera
    frame.render = render
    frame.dpr = renderer.dpr
    frame.cssW = renderer.cssSize.w
    frame.cssH = renderer.cssSize.h
    frame.dt = dt
    frame.marks = scene.engine?.perfMarks ?? false
    this.#setCull(frame, camera)
    this.#spaceDepth = 0
    const st = this.stats
    st.nodes = 0
    st.paints = 0
    st.replays = 0
    st.culled = 0
    this.painters.clear()
    this.streamers.clear()
    this.#cleanCount = 0
    this.#walk(scene.root, frame, 1, null, camera)
    gfx.setAlpha(1)
    if (this.stalenessSamples > 0) this.#checkStaleness()
    const t = this.totals
    t.frames++
    if (st.paints > 0) t.framesPainted++
    t.paints += st.paints
  }

  /**
   * Pictures painted in the frame just drawn, counted by node class. A scene
   * whose content should be at rest names whatever keeps it from being.
   */
  readonly painters = new Map<string, number>()

  /**
   * Vertex and instance bytes each picture streamed to the GPU in the frame
   * just drawn, by node class and id. Development only.
   */
  readonly streamers = new Map<string, number>()

  /** Counts for the frame just drawn. */
  readonly stats = { nodes: 0, paints: 0, replays: 0, culled: 0 }

  /**
   * Counts since the walk was created: frames drawn, frames in which any
   * picture was painted, pictures painted, and nodes the staleness checker
   * found out of date. A session of resting content has `framesPainted` far
   * below `frames`, and a healthy one has `stale` at 0.
   */
  readonly totals = { frames: 0, framesPainted: 0, paints: 0, stale: 0 }

  /**
   * How many clean pictures are painted again each frame and compared with the
   * ones kept, to catch a node whose picture went stale without being marked.
   * On in development, off otherwise. A mismatch logs once per node.
   */
  stalenessSamples = import.meta.env.DEV ? 2 : 0
  readonly #canvas = new Canvas()
  readonly #scratch = new Picture()
  readonly #clean: { node: Node2D; scale: number; view: CameraView2D }[] = []
  #cleanCount = 0
  #sample = 0
  readonly #warned = new WeakSet<Node2D>()

  readonly #frame: WalkFrame = {
    gfx: null as unknown as Gfx2D,
    camera: null as unknown as CameraView2D,
    render: null as unknown as Affine2x3,
    dpr: 1,
    cssW: 0,
    cssH: 0,
    dt: 0,
    marks: false,
    strokeScale: 1,
    visLeft: 0,
    visRight: 0,
    visTop: 0,
    visBottom: 0,
  }

  /**
   * Set the frame's stroke scale and cull rect for `view`. The cull rect comes
   * from the canvas corners rather than the view's viewport, so it includes
   * letterbox margins. Otherwise content still on screen in the uncovered axis
   * would be clipped.
   */
  #setCull(f: WalkFrame, view: CameraView2D): void {
    view.screenToWorld(0, 0, this.#cullTL)
    view.screenToWorld(f.cssW, f.cssH, this.#cullBR)
    f.strokeScale = view.strokeSpaceScale()
    f.visLeft = Math.min(this.#cullTL.x, this.#cullBR.x)
    f.visRight = Math.max(this.#cullTL.x, this.#cullBR.x)
    f.visTop = Math.min(this.#cullTL.y, this.#cullBR.y)
    f.visBottom = Math.max(this.#cullTL.y, this.#cullBR.y)
  }

  /** The frame values a layer's space replaced, one entry per open layer. */
  readonly #spaces: SavedSpace[] = []
  /** The render affine of each open layer's space, reused between frames. */
  readonly #spaceRenders: Affine2x3[] = []
  #spaceDepth = 0

  /**
   * Switch the frame to the view of `layer`: its render affine (device pixels
   * from the layer's view), camera, stroke scale and cull rect. Pair it with
   * `#leaveSpace`.
   */
  #enterSpace(layer: Layer, f: WalkFrame): CameraView2D {
    layer._syncView(f.cssW, f.cssH)
    const view = layer.view!
    const depth = this.#spaceDepth++
    const saved = (this.#spaces[depth] ??= {
      render: f.render,
      camera: f.camera,
      strokeScale: 1,
      visLeft: 0,
      visRight: 0,
      visTop: 0,
      visBottom: 0,
    })
    saved.render = f.render
    saved.camera = f.camera
    saved.strokeScale = f.strokeScale
    saved.visLeft = f.visLeft
    saved.visRight = f.visRight
    saved.visTop = f.visTop
    saved.visBottom = f.visBottom
    const render = (this.#spaceRenders[depth] ??= {
      a: 1,
      b: 0,
      c: 0,
      d: 1,
      e: 0,
      f: 0,
    })
    const s = view.getScreenAffine()
    const dpr = f.dpr
    render.a = dpr * s.a
    render.b = dpr * s.b
    render.c = dpr * s.c
    render.d = dpr * s.d
    render.e = dpr * s.e
    render.f = dpr * s.f
    f.render = render
    f.camera = view
    this.#setCull(f, view)
    return view
  }

  /** Put back what the matching `#enterSpace` replaced. */
  #leaveSpace(f: WalkFrame): void {
    const saved = this.#spaces[--this.#spaceDepth]
    f.render = saved.render
    f.camera = saved.camera
    f.strokeScale = saved.strokeScale
    f.visLeft = saved.visLeft
    f.visRight = saved.visRight
    f.visTop = saved.visTop
    f.visBottom = saved.visBottom
  }

  /**
   * Visit `node` and its subtree. `alpha` is the product of the alphas above
   * it, `outerInset` the nearest enclosing inset (with `outerView` the camera
   * its descendants see).
   */
  #walk(
    node: Node,
    f: WalkFrame,
    alpha: number,
    outerInset: InsetViewNode | null,
    outerView: CameraView2D,
  ): void {
    if (!node.visible) return
    const children = node.children
    if (node.kind !== '2d') {
      for (let i = 0; i < children.length; i++) {
        this.#walk(children[i], f, alpha, outerInset, outerView)
      }
      return
    }
    const n2 = node as Node2D
    // A matte is drawn by the node it serves, not where it sits in the tree.
    if (n2._matteOf !== null && n2 !== this.#matteDrawn) return
    // A layer with a space of its own is placed by its view, which also takes
    // it out of any inset, because an inset frames only the camera's space.
    const space = n2 instanceof Layer && n2.view !== null ? n2 : null
    const view = space ? this.#enterSpace(space, f) : outerView
    const inset = space ? null : outerInset
    const gfx = f.gfx
    const cascaded = alpha * n2.transform.alpha
    const matte = n2.matte !== null && !n2.matte.isDestroyed ? n2.matte : null
    // A layer with effects, or one that keeps its render, always draws into a
    // surface, so the effects have something to process.
    const effects = n2 instanceof Layer && n2._usesSurface() ? n2 : null
    if (effects) {
      effects._fx.applied = false
      effects._cacheState.hit = false
    }
    const grouped =
      (n2.compositeGroup ||
        n2.compositeBlend !== 'source-over' ||
        matte ||
        effects) &&
      !inset &&
      this.#beginGroup(n2, matte, f, cascaded, view)
    if (effects && !grouped) this.#warnNoEffects(effects, inset !== null)
    // A cached layer whose kept render stands is composited as it is, and its
    // subtree is neither drawn nor visited.
    const kept = grouped && effects !== null && effects._cacheState.hit
    // A group's contents draw at full opacity into its surface, and the
    // surface carries the node's alpha when it is composited.
    const nodeAlpha = grouped ? 1 : cascaded
    let childInset = inset
    let childView = view
    if (n2 instanceof InsetViewNode) {
      childInset = n2
      let insetView = this.#insetViews.get(n2)
      if (!insetView) {
        insetView = new InsetCameraView()
        this.#insetViews.set(n2, insetView)
      }
      childView = insetView.bind(f.camera, n2)
    }

    // A clip owner clips itself and everything under it. A rectangle on an
    // axis-aligned node clips in the shader, which costs no draw. It cannot
    // nest, so an inner clip, a rotated node and a path use the stencil.
    const clipped = !kept && n2.clip !== null
    let analytic = false
    if (clipped) {
      gfx.save()
      setFinalTransform(gfx, f.render, n2.transform.world)
      const clip = n2.clip as GfxPath | Rect
      const w = n2.transform.world
      const r = f.render
      if (
        !(clip instanceof GfxPath) &&
        inset === null &&
        this.#analyticClip === null &&
        Math.abs(r.b * w.a + r.d * w.b) < 1e-6 &&
        Math.abs(r.a * w.c + r.c * w.d) < 1e-6
      ) {
        const shape = this.#clipShape
        shape.x = clip.x
        shape.y = clip.y
        shape.w = clip.width
        shape.h = clip.height
        gfx.setClip(shape)
        this.#analyticClip = shape
        this.#analyticOwner = n2
        analytic = true
      } else {
        gfx.clipPath(this.#clipPathOf(n2))
      }
    }

    if (!n2.intrinsic && !kept) {
      if (n2.paint) {
        this.#paintAndDraw(n2, f, nodeAlpha, inset, view)
      } else if (n2.draw) {
        // Skip nodes whose bounds are fully outside the visible rect. Only
        // nodes that declare `boundsOverride` can be culled, the rest always
        // draw.
        const culled =
          n2.boundsOverride !== null &&
          this.#isOutsideView(n2, n2.boundsOverride, f, node2Margin(n2, f))
        if (culled) this.stats.culled++
        else this.#drawNode(n2, f, nodeAlpha, inset, view, null)
      }
    }

    if (!kept) {
      for (let i = 0; i < children.length; i++) {
        this.#walk(children[i], f, nodeAlpha, childInset, childView)
      }
    }

    if (clipped) {
      gfx.restore()
      if (analytic) {
        this.#analyticClip = null
        this.#analyticOwner = null
      }
    }
    if (grouped) this.#endGroup(n2, matte, f, cascaded, view)
    if (space) this.#leaveSpace(f)
  }

  /**
   * Open an offscreen surface over the device-space box of `node`, its subtree
   * and its matte's, to be composited with `opacity`. False when the subtree
   * cannot be grouped or surfaces are unavailable, and the node then draws as
   * if it were not a group.
   */
  #beginGroup(
    node: Node2D,
    matte: Node2D | null,
    f: WalkFrame,
    opacity: number,
    view: CameraView2D,
  ): boolean {
    const box = this.#groupBox
    box.minX = Infinity
    box.minY = Infinity
    box.maxX = -Infinity
    box.maxY = -Infinity
    box.unbounded = false
    if (!this.#growGroupBox(node, f, view)) return false
    if (matte) {
      const outer = this.#matteDrawn
      this.#matteDrawn = matte
      const ok = this.#growGroupBox(matte, f, view)
      this.#matteDrawn = outer
      if (!ok) return false
    }
    const gfx = f.gfx
    this.#fitGroupBox(node, f)
    gfx.setBaseTransform(1, 0, 0, 1, 0, 0)
    // The surface multiplies in the alpha in effect, which is whatever the
    // last node left behind.
    gfx.setAlpha(1)
    const layer = node instanceof Layer && node._usesSurface() ? node : null
    const bounds = layer
      ? this.#layerBounds(layer, f)
      : box.unbounded || box.minX > box.maxX
        ? undefined
        : {
            x: box.minX,
            y: box.minY,
            width: box.maxX - box.minX,
            height: box.maxY - box.minY,
          }
    if (layer) {
      layer._fx.effects = this.#effectsOf(layer)
      layer._fx.dt = f.dt
      if (layer.cache === 'raster') {
        this.#signLayer(layer, f, view)
        layer._fx.cache = layer._cacheState
      } else {
        layer._fx.cache = undefined
      }
    }
    const opened = gfx.beginOffscreen({
      bounds,
      opacity,
      blend:
        node.compositeBlend === 'source-over' ? undefined : node.compositeBlend,
      retain: matte !== null,
      effects: layer ? layer._fx : undefined,
      clearColor: layer?.clearColor ?? undefined,
    })
    if (!opened) return false
    // The matte is drawn over the same area once the node's own surface closes.
    const entry = (this.#groups[this.#groupDepth] ??= {
      bounds: { x: 0, y: 0, width: 0, height: 0 },
      bounded: false,
    })
    this.#groupDepth++
    entry.bounded = bounds !== undefined
    if (bounds) Object.assign(entry.bounds, bounds)
    this.#reapplyClip(f)
    return true
  }

  /** What each cached layer's output depends on, rebuilt every frame. */
  readonly #signatures = new WeakMap<Layer, LayerSignature>()
  /** The effect a cached layer without effects runs, to land in its kept target. */
  readonly #copy: readonly PostEffect[] = [new Copy()]

  /** The effects a layer's surface runs: its own, or a copy for a bare cache. */
  #effectsOf(layer: Layer): readonly PostEffect[] {
    return layer._hasEffects() ? layer.effects : this.#copy
  }

  /** Layers already warned that they cannot be cached. */
  readonly #warnedUncached = new WeakSet<Layer>()

  /**
   * Describe, as numbers, everything a cached layer's output depends on: the
   * view, the region, and for every node under it what it is, whether it shows,
   * its alpha, where it sits, how it composites, and which recording of its
   * drawing it has. Two frames with equal signatures draw the same pixels. This
   * paints any picture that is out of date, which the draw would do anyway.
   */
  #signLayer(layer: Layer, f: WalkFrame, view: CameraView2D): void {
    let sig = this.#signatures.get(layer)
    if (!sig) {
      sig = new LayerSignature()
      this.#signatures.set(layer, sig)
    }
    sig.begin()
    sig.pushAffine(f.render)
    sig.push(f.dpr)
    sig.push(f.cssW)
    sig.push(f.cssH)
    const region = layer.region
    if (region === 'content') {
      sig.push(0)
    } else if (region === 'view') {
      sig.push(1)
    } else {
      sig.push(2)
      sig.push(region.x)
      sig.push(region.y)
      sig.push(region.width)
      sig.push(region.height)
    }
    sig.push(layer.padding)
    sig.push(layer.clearColor === null ? 0 : hashString(layer.clearColor))
    this.#signNode(layer, f, view, sig, layer)
    const cache = layer._cacheState
    cache.signature = sig.words
    cache.length = sig.length
  }

  /**
   * Add `node` and what is under it to `sig`. `root` is the layer being signed:
   * its own alpha is applied when its render is drawn, so it stays out.
   */
  #signNode(
    node: Node,
    f: WalkFrame,
    view: CameraView2D,
    sig: LayerSignature,
    root: Layer,
  ): void {
    sig.push(nodeKey(node))
    if (!node.visible) {
      sig.push(0)
      return
    }
    sig.push(1)
    let nested: Layer | null = null
    if (node.kind === '2d') {
      const n2 = node as Node2D
      const isRoot = n2 === root
      if (!isRoot) {
        sig.push(n2.transform.alpha)
        sig.pushAffine(n2.transform.world)
      }
      sig.push(n2.compositeGroup ? 1 : 0)
      sig.push(hashString(n2.compositeBlend))
      sig.push(n2.pixelSnap ? 1 : 0)
      const clip = n2.clip
      if (clip === null) {
        sig.push(0)
      } else if (clip instanceof GfxPath) {
        sig.push(1)
        sig.push(nodeKey(clip))
        sig.push(clip.version)
      } else {
        sig.push(2)
        sig.push(clip.x)
        sig.push(clip.y)
        sig.push(clip.width)
        sig.push(clip.height)
      }
      if (n2.matte !== null || n2._matteOf !== null) {
        this.#uncacheable(sig, root, 'holds a matte')
      }
      if (!n2.intrinsic) {
        if (n2.paint) {
          sig.push(this.#ensurePainted(n2, f, view).generation)
        } else if (n2.draw) {
          this.#uncacheable(sig, root, 'holds a node that draws immediately')
        }
      }
      if (!isRoot && n2 instanceof Layer) {
        if (n2._hasEffects()) {
          this.#uncacheable(sig, root, 'holds a layer with effects')
        }
        if (n2.view !== null) nested = n2
      }
    }
    // A layer with a space of its own is placed by its view, which the pictures
    // under it were recorded against.
    const inner = nested ? this.#enterSpace(nested, f) : view
    if (nested) sig.pushAffine(f.render)
    const children = node.children
    for (let i = 0; i < children.length; i++) {
      this.#signNode(children[i], f, inner, sig, root)
    }
    if (nested) this.#leaveSpace(f)
  }

  /**
   * Make a signature that never repeats, so the layer renders every frame, and
   * say so once in development.
   */
  #uncacheable(sig: LayerSignature, layer: Layer, why: string): void {
    sig.push(this.totals.frames + 0.5)
    if (!import.meta.env.DEV || this.#warnedUncached.has(layer)) return
    this.#warnedUncached.add(layer)
    console.warn(
      `Layer ${layer.id} is cached but ${why}, so it renders every frame.`,
    )
  }

  /** Layers already warned that they draw without their effects. */
  readonly #warnedLayers = new WeakSet<Layer>()
  readonly #layerBox: DeviceBox = { x: 0, y: 0, width: 0, height: 0 }

  /**
   * The device-pixel region a layer's effects run over: the subtree's box, the
   * whole canvas, or the layer's own rect, plus its padding. `undefined` means
   * the whole canvas.
   */
  #layerBounds(layer: Layer, f: WalkFrame): DeviceBox | undefined {
    const out = this.#layerBox
    const mode = layer.region
    if (mode === 'view') return undefined
    if (mode === 'content') {
      const box = this.#groupBox
      if (box.unbounded || box.minX > box.maxX) return undefined
      out.x = box.minX
      out.y = box.minY
      out.width = box.maxX - box.minX
      out.height = box.maxY - box.minY
    } else {
      deviceBoundsOfRect(mode, layer.transform.world, f.render, out)
    }
    return padBox(out, layer.padding * f.dpr)
  }

  /**
   * Say, once per layer in development, why a layer is drawn without its
   * effects. A subtree with an inset view cannot be drawn into a surface, and
   * neither can anything inside an inset.
   */
  #warnNoEffects(layer: Layer, insideInset: boolean): void {
    if (!import.meta.env.DEV || this.#warnedLayers.has(layer)) return
    this.#warnedLayers.add(layer)
    console.warn(
      insideInset
        ? `Layer ${layer.id} has effects but sits inside an InsetViewNode, so it draws without them.`
        : `Layer ${layer.id} has effects but holds an InsetViewNode, so it draws without them.`,
    )
  }

  /**
   * Adjust the group box before its surface opens. A blend that changes pixels
   * where its source is empty (`destination-in`, `xor`) needs the whole area of
   * the surface it composites into. A rectangle clip in effect limits the box
   * to the clip, because the composite does not read it.
   */
  #fitGroupBox(node: Node2D, f: WalkFrame): void {
    const box = this.#groupBox
    const blend = node.compositeBlend
    if (blend === 'destination-in' || blend === 'xor') {
      const parent = this.#groupDepth > 0 && this.#groups[this.#groupDepth - 1]
      if (parent && parent.bounded) {
        box.minX = parent.bounds.x
        box.minY = parent.bounds.y
        box.maxX = parent.bounds.x + parent.bounds.width
        box.maxY = parent.bounds.y + parent.bounds.height
        box.unbounded = false
      } else {
        box.unbounded = true
      }
    }
    const clip = this.#analyticClip
    const owner = this.#analyticOwner
    if (!clip || !owner) return
    const r = f.render
    const w = owner.transform.world
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (let i = 0; i < 4; i++) {
      const lx = clip.x + (i === 1 || i === 2 ? clip.w : 0)
      const ly = clip.y + (i >= 2 ? clip.h : 0)
      const wx = w.a * lx + w.c * ly + w.e
      const wy = w.b * lx + w.d * ly + w.f
      const dx = r.a * wx + r.c * wy + r.e
      const dy = r.b * wx + r.d * wy + r.f
      if (dx < minX) minX = dx
      if (dx > maxX) maxX = dx
      if (dy < minY) minY = dy
      if (dy > maxY) maxY = dy
    }
    if (box.unbounded) {
      box.minX = minX
      box.minY = minY
      box.maxX = maxX
      box.maxY = maxY
      box.unbounded = false
    } else {
      box.minX = Math.max(box.minX, minX)
      box.minY = Math.max(box.minY, minY)
      box.maxX = Math.min(box.maxX, maxX)
      box.maxY = Math.min(box.maxY, maxY)
    }
  }

  /**
   * A surface starts without a clip. Put the rectangle clip in effect back, so
   * what is drawn into the surface is clipped as it would be outside it.
   */
  #reapplyClip(f: WalkFrame): void {
    const clip = this.#analyticClip
    const owner = this.#analyticOwner
    if (!clip || !owner) return
    setFinalTransform(f.gfx, f.render, owner.transform.world)
    f.gfx.setClip(clip)
  }

  /**
   * Close the surface `#beginGroup` opened and composite it, through the matte
   * when there is one.
   */
  #endGroup(
    node: Node2D,
    matte: Node2D | null,
    f: WalkFrame,
    opacity: number,
    view: CameraView2D,
  ): void {
    const gfx = f.gfx
    const entry = this.#groups[this.#groupDepth - 1]
    if (!matte) {
      this.#groupDepth--
      gfx.endOffscreen()
      return
    }
    const content = gfx.endOffscreen()
    gfx.setBaseTransform(1, 0, 0, 1, 0, 0)
    gfx.setAlpha(1)
    let cover = null
    if (
      gfx.beginOffscreen({
        bounds: entry.bounded ? entry.bounds : undefined,
        retain: true,
      })
    ) {
      this.#reapplyClip(f)
      const outer = this.#matteDrawn
      this.#matteDrawn = matte
      this.#walk(matte, f, 1, null, view)
      this.#matteDrawn = outer
      cover = gfx.endOffscreen()
    }
    this.#groupDepth--
    if (!content) return
    gfx.drawOffscreen(content, {
      opacity,
      blend:
        node.compositeBlend === 'source-over' ? undefined : node.compositeBlend,
      matte: cover ?? undefined,
      matteMode: cover ? node.matteMode : undefined,
    })
  }

  /** The rectangle clip in effect, which an inset restores after it draws. */
  #analyticClip: RectClip | null = null
  #analyticOwner: Node2D | null = null
  readonly #clipShape: RectClip = {
    kind: 'roundRect',
    x: 0,
    y: 0,
    w: 0,
    h: 0,
    radius: 0,
  }

  /** The matte being drawn or measured, which the walk does not skip. */
  #matteDrawn: Node2D | null = null
  readonly #groups: {
    bounds: { x: number; y: number; width: number; height: number }
    bounded: boolean
  }[] = []
  #groupDepth = 0

  /**
   * Grow the group box over `node` and its visible subtree, painting any node
   * whose picture is out of date so its bounds are known. False when the
   * subtree has an inset view, which cannot be drawn into a surface.
   */
  #growGroupBox(node: Node, f: WalkFrame, view: CameraView2D): boolean {
    if (!node.visible) return true
    if (node.kind === '2d') {
      const n2 = node as Node2D
      if (n2._matteOf !== null && n2 !== this.#matteDrawn) return true
      if (n2 instanceof InsetViewNode) return false
      if (!n2.intrinsic && n2.paint) {
        const pic = this.#ensurePainted(n2, f, view)
        const b = this.#cullBounds(n2, pic)
        if (b === null) {
          this.#groupBox.unbounded = true
        } else {
          const w = n2.transform.world
          const r = f.render
          const m = Math.sqrt(Math.abs(r.a * r.d - r.b * r.c))
          const pad = (pic.screenPad || 0) * f.strokeScale * m + 3
          for (let i = 0; i < 4; i++) {
            const lx = b.x + (i === 1 || i === 2 ? b.width : 0)
            const ly = b.y + (i >= 2 ? b.height : 0)
            const wx = w.a * lx + w.c * ly + w.e
            const wy = w.b * lx + w.d * ly + w.f
            const dx = r.a * wx + r.c * wy + r.e
            const dy = r.b * wx + r.d * wy + r.f
            const box = this.#groupBox
            box.minX = Math.min(box.minX, dx - pad)
            box.minY = Math.min(box.minY, dy - pad)
            box.maxX = Math.max(box.maxX, dx + pad)
            box.maxY = Math.max(box.maxY, dy + pad)
          }
        }
      } else if (!n2.intrinsic && n2.draw) {
        this.#groupBox.unbounded = true
      }
    }
    const children = node.children
    for (let i = 0; i < children.length; i++) {
      if (!this.#growGroupBox(children[i], f, view)) return false
    }
    return true
  }

  readonly #groupBox = {
    minX: 0,
    minY: 0,
    maxX: 0,
    maxY: 0,
    unbounded: false,
  }

  /**
   * Paint the node if its picture is missing or stale, once per frame, and
   * return the picture.
   */
  #ensurePainted(node: Node2D, f: WalkFrame, view: CameraView2D): Picture {
    if (node._walkStamp === this.totals.frames && node._picture) {
      return node._picture
    }
    node._walkStamp = this.totals.frames
    const w = node.transform.world
    const r = f.render
    // Device pixels per local unit: the root of the area scale of render · world.
    const scale = Math.sqrt(
      Math.abs(
        (r.a * w.a + r.c * w.b) * (r.b * w.c + r.d * w.d) -
          (r.b * w.a + r.d * w.b) * (r.a * w.c + r.c * w.d),
      ),
    )
    let pic = node._picture
    let repaint = node._paintDirty || pic === null
    if (!repaint && pic) {
      if (pic.depsChanged()) {
        repaint = true
      } else if (pic.usesCamera && cameraMoved(pic, view)) {
        repaint = true
      } else if (
        pic.usesScreenScale &&
        pic.screenScale !== view.strokeSpaceScale()
      ) {
        repaint = true
      } else if (pic.scaleDependent) {
        // A picture drawn from the scale keeps the one it has while the scale
        // moves, and is redrawn once the scale has stopped at another value.
        // Snapped lengths round differently at every scale, so the picture has
        // to be current for the scale it rests at.
        const atRest = Math.abs(scale / node._lastScale - 1) < AT_REST_EPSILON
        if (atRest && scale !== pic.paintedScale) repaint = true
      }
    }
    node._lastScale = scale
    if (repaint) {
      pic = this.#paint(node, scale, view)
    } else if (
      this.stalenessSamples > 0 &&
      // A picture that follows the scale is allowed to lag it while it moves.
      !(pic!.scaleDependent && scale !== pic!.paintedScale)
    ) {
      const c =
        this.#clean[this.#cleanCount] ??
        (this.#clean[this.#cleanCount] = {
          node,
          scale,
          view,
        })
      c.node = node
      c.scale = scale
      c.view = view
      this.#cleanCount++
    }
    return pic!
  }

  /**
   * Paint the node if its picture is missing or stale, cull it by the picture's
   * bounds, and replay the picture.
   */
  #paintAndDraw(
    node: Node2D,
    f: WalkFrame,
    alpha: number,
    inset: InsetViewNode | null,
    view: CameraView2D,
  ): void {
    const pic = this.#ensurePainted(node, f, view)
    this.stats.nodes++
    const bounds = this.#cullBounds(node, pic)
    if (
      bounds &&
      this.#isOutsideView(
        node,
        bounds,
        f,
        (pic.screenPad || 0) * f.strokeScale + CULL_AA_PAD_WORLD,
      )
    ) {
      this.stats.culled++
      return
    }
    this.#drawNode(node, f, alpha, inset, view, pic)
  }

  /**
   * What to cull the node by: the picture's bounds and the node's override
   * together, so a node that takes taps over a region smaller than what it
   * paints, such as a box with a shadow, is not culled while the shadow shows.
   */
  #cullBounds(node: Node2D, pic: Picture): Rect | null {
    const over = node.boundsOverride
    const own = pic.bounds
    if (over === null || own === null) return over ?? own
    const out = this.#cullScratch
    out.x = Math.min(over.x, own.x)
    out.y = Math.min(over.y, own.y)
    out.width = Math.max(over.x + over.width, own.x + own.width) - out.x
    out.height = Math.max(over.y + over.height, own.y + own.height) - out.y
    return out
  }

  readonly #cullScratch: Rect = { x: 0, y: 0, width: 0, height: 0 }

  /** Record the node's picture. */
  #paint(node: Node2D, scale: number, view: CameraView2D): Picture {
    const pic = (node._picture ??= new Picture())
    beginPaint(node)
    this.#canvas.begin(pic, scale, view)
    try {
      node.paint!(this.#canvas)
    } finally {
      this.#canvas.end()
      endPaint()
    }
    pic.paintedScale = scale
    pic.generation++
    node._paintDirty = false
    this.stats.paints++
    const type = node.constructor.name
    this.painters.set(type, (this.painters.get(type) ?? 0) + 1)
    return pic
  }

  /**
   * Paint a few of the clean nodes again into a scratch picture and compare it
   * with the one kept. A difference means something the picture was drawn from
   * changed without the node being marked for repaint.
   */
  #checkStaleness(): void {
    const n = this.#cleanCount
    if (n === 0) return
    const count = Math.min(this.stalenessSamples, n)
    for (let k = 0; k < count; k++) {
      const c = this.#clean[this.#sample++ % n]
      const kept = c.node._picture
      if (!kept || c.node.isDestroyed || this.#warned.has(c.node)) continue
      beginPaint(c.node)
      this.#canvas.begin(this.#scratch, c.scale, c.view)
      try {
        c.node.paint!(this.#canvas)
      } finally {
        this.#canvas.end()
        endPaint()
      }
      const at = kept.firstDifference(this.#scratch)
      if (at >= 0) {
        this.#warned.add(c.node)
        this.totals.stale++
        const op = OP_NAMES[this.#scratch.ops[at] ?? kept.ops[at]] ?? 'end'
        console.warn(
          `stale picture: ${c.node.id} paints differently now than when it last painted (first difference at call ${at}, ${op}). It changed without a paint property, a versioned resource or markNeedsPaint().`,
        )
      }
    }
  }

  /** Set up the transform, alpha and inset clip for one node, then draw it. */
  #drawNode(
    node: Node2D,
    f: WalkFrame,
    alpha: number,
    inset: InsetViewNode | null,
    view: CameraView2D,
    picture: Picture | null,
  ): void {
    const gfx = f.gfx
    // A node inside an inset draws clipped to the inset's rounded rect and
    // sees the inset's camera, so its screen-space strokes keep their size.
    if (inset) {
      setFinalTransform(gfx, f.render, inset.transform.world)
      gfx.setClip({
        kind: 'roundRect',
        x: 0,
        y: 0,
        w: inset.width,
        h: inset.height,
        radius: inset.radius,
      })
    }
    // final = render · node.world (full 2×3 matmul, the camera affine may be
    // rotated/skewed via a transformed or parented camera). For an identity
    // camera `render` is uniform-scale + translate, so this reduces to the old
    // `scaleDpr * w.* (+ off)` fast path with identical numbers.
    setFinalTransform(gfx, f.render, node.transform.world, node.pixelSnap)
    gfx.setAlpha(alpha)
    const marks = f.marks
    const id = marks ? node.id : ''
    const startMark = marks ? `draw-${id}:start` : ''
    if (marks) performance.mark(startMark)
    if (picture) {
      // In development, charge what the replay streamed to the node, so the
      // HUD can name the pictures that upload the most every frame.
      const before =
        this.stalenessSamples > 0 ? (gfx.streamedBytes?.() ?? -1) : -1
      picture.replay(gfx, view)
      if (before >= 0) {
        const bytes = gfx.streamedBytes!() - before
        if (bytes > 0) {
          const name = `${node.constructor.name} ${node.id}`
          this.streamers.set(name, (this.streamers.get(name) ?? 0) + bytes)
        }
      }
      this.stats.replays++
    } else {
      node.draw!(gfx, view, f.dt)
    }
    if (inset) gfx.setClip(this.#analyticClip)
    if (marks) {
      const endMark = `draw-${id}:end`
      performance.mark(endMark)
      performance.measure(`draw ${id}`, startMark, endMark)
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
   * True when the world-space box of `b` (a local rect) pushed through `node`'s
   * world matrix lies fully outside the visible rect, with `margin` world units
   * of slack. All four corners are mapped, so rotated nodes are handled.
   */
  #isOutsideView(node: Node2D, b: Rect, f: WalkFrame, margin: number): boolean {
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
    return (
      maxX < f.visLeft - margin ||
      minX > f.visRight + margin ||
      maxY < f.visTop - margin ||
      minY > f.visBottom + margin
    )
  }
}

/**
 * The cull margin of a node that draws directly: its stroke half-width and
 * `cullMargin` (an outside-aligned border, a shadow's offset, blur and spread),
 * in world units, plus the antialiasing slack. Screen-space strokes, the
 * default, scale by the camera's stroke scale and world-space ones are already
 * in world units.
 */
function node2Margin(node: Node2D, f: WalkFrame): number {
  const strokeNode = node as {
    lineWidth?: number
    strokeSpace?: string
    cullMargin?: number
  }
  const raw = (strokeNode.lineWidth ?? 0) * 0.5 + (strokeNode.cullMargin ?? 0)
  const world =
    raw > 0
      ? strokeNode.strokeSpace === 'world'
        ? raw
        : raw * f.strokeScale
      : 0
  return world + CULL_AA_PAD_WORLD
}

/** Whether the camera's visible rect differs from the one `pic` was drawn for. */
function cameraMoved(pic: Picture, view: CameraView2D): boolean {
  const r = view.visibleWorldRect()
  return (
    r.x !== pic.cameraX ||
    r.y !== pic.cameraY ||
    r.width !== pic.cameraW ||
    r.height !== pic.cameraH
  )
}

/**
 * Set `gfx`'s base transform to `render · world`, with the origin rounded to a
 * whole device pixel when `snap` is set.
 */
function setFinalTransform(
  gfx: Gfx2D,
  render: Affine2x3,
  w: Affine2x3,
  snap = false,
): void {
  const e = render.a * w.e + render.c * w.f + render.e
  const f = render.b * w.e + render.d * w.f + render.f
  gfx.setBaseTransform(
    render.a * w.a + render.c * w.b,
    render.b * w.a + render.d * w.b,
    render.a * w.c + render.c * w.d,
    render.b * w.c + render.d * w.d,
    snap ? Math.round(e) : e,
    snap ? Math.round(f) : f,
  )
}
