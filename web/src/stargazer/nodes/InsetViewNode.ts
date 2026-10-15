import { Node2D } from '../scene/Node2D'
import type { Affine2x3, CameraView2D } from '../camera/CameraView2D'
import type { Rect } from '../math/Rect'
import type { Vec2 } from '../math/Vec2'

/** Options for an {@link InsetViewNode}. */
export interface InsetViewOptions {
  /** Size of the inset on the parent scene, in the parent's local units. */
  width: number
  height: number
  /** Corner radius of the inset's clip, in the same units. Default 0. */
  radius?: number
  /**
   * The rect of the inset's own world that it shows. Defaults to `0, 0, width,
   * height`, one inset unit per parent unit.
   */
  viewport?: Rect
}

/**
 * A window onto a separate 2D world, drawn inside a rounded rect on the scene
 * it sits in, like a picture-in-picture view with a camera of its own.
 *
 * Build the inner world under {@link InsetViewNode.content}, in its own units.
 * Set {@link InsetViewNode.viewport} to the rect of that world to show, as often
 * as every frame, to pan and zoom the way a camera would, such as following a
 * moving subject. The rect is fitted into the inset preserving aspect,
 * centred.
 *
 * Everything under `content` is clipped to the inset's rounded rect, and draws
 * with a camera view that accounts for the inset's zoom, so a screen-space
 * stroke stays the width it asks for on screen and `visibleWorldRect` reports
 * the inner world's visible rect.
 *
 * Limits:
 *
 * - The clip is the analytic clip, of which there is one at a time. A node inside
 *   that calls `setClip` itself replaces the inset's clip for its own draw.
 * - An inset inside another inset is clipped to the inner one only.
 * - Pointer input and HTML anchored with `domAnchor` do not see the inset's view,
 *   so they treat inner nodes in parent coordinates.
 *
 * @example
 *   const inset = new InsetViewNode({ width: 392, height: 516, radius: 40 })
 *   inset.content.add(planet)
 *   engine.events.on('frame', () => {
 *     inset.viewport = {
 *       x: planet.transform.x - 39,
 *       y: -52,
 *       width: 78,
 *       height: 104,
 *     }
 *   })
 *   card.add(inset)
 */
export class InsetViewNode extends Node2D {
  /** Root of the inset's own world. Add inner nodes here. */
  readonly content: Node2D
  readonly width: number
  readonly height: number
  readonly radius: number
  #viewport: Rect

  constructor(opts: InsetViewOptions, id?: string) {
    super(id ?? 'inset-view')
    this.width = opts.width
    this.height = opts.height
    this.radius = opts.radius ?? 0
    this.boundsOverride = { x: 0, y: 0, width: opts.width, height: opts.height }
    this.content = new Node2D(`${this.id}-content`)
    this.add(this.content)
    this.#viewport = { x: 0, y: 0, width: opts.width, height: opts.height }
    this.viewport = opts.viewport ?? this.#viewport
  }

  /** The rect of the inner world shown, fitted into the inset. */
  get viewport(): Rect {
    return this.#viewport
  }

  set viewport(rect: Rect) {
    this.#viewport = { ...rect }
    const vw = rect.width > 0 ? rect.width : 1
    const vh = rect.height > 0 ? rect.height : 1
    const s = Math.min(this.width / vw, this.height / vh)
    const t = this.content.transform
    t.scaleX = s
    t.scaleY = s
    t.x = (this.width - vw * s) / 2 - rect.x * s
    t.y = (this.height - vh * s) / 2 - rect.y * s
  }
}

/**
 * A camera view for nodes inside an inset: the outer view composed with the
 * inset's content transform. One per inset, rebound each time it is used, so
 * drawing allocates nothing.
 */
export class InsetCameraView implements CameraView2D {
  #outer: CameraView2D | null = null
  #inset: InsetViewNode | null = null
  readonly #affine: Affine2x3 = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }
  readonly #scratch: Vec2 = { x: 0, y: 0 }

  /** Point the view at `inset`, seen through `outer`. Returns `this`. */
  bind(outer: CameraView2D, inset: InsetViewNode): this {
    this.#outer = outer
    this.#inset = inset
    return this
  }

  /** Uniform scale from the inset's world to the outer world. */
  #zoom(): number {
    const w = this.#inset!.content.transform.world
    return Math.sqrt(Math.abs(w.a * w.d - w.b * w.c)) || 1
  }

  screenToWorld(x: number, y: number, out?: Vec2): Vec2 {
    const world = this.#outer!.screenToWorld(x, y, this.#scratch)
    const local = this.#inset!.content.worldToLocal(world.x, world.y)
    const o = out ?? { x: 0, y: 0 }
    o.x = local.x
    o.y = local.y
    return o
  }

  worldToScreen(x: number, y: number, out?: Vec2): Vec2 {
    const world = this.#inset!.content.localToWorld(x, y)
    return this.#outer!.worldToScreen(world.x, world.y, out)
  }

  visibleWorldRect(out?: Rect): Rect {
    const v = this.#inset!.viewport
    const o = out ?? { x: 0, y: 0, width: 0, height: 0 }
    o.x = v.x
    o.y = v.y
    o.width = v.width
    o.height = v.height
    return o
  }

  screenPxPerWorldUnit(): number {
    return this.#outer!.screenPxPerWorldUnit() * this.#zoom()
  }

  strokeSpaceScale(): number {
    return this.#outer!.strokeSpaceScale() / this.#zoom()
  }

  getScreenAffine(out?: Affine2x3): Affine2x3 {
    const p = this.#outer!.getScreenAffine()
    const w = this.#inset!.content.transform.world
    const o = out ?? this.#affine
    const a = p.a * w.a + p.c * w.b
    const b = p.b * w.a + p.d * w.b
    const c = p.a * w.c + p.c * w.d
    const d = p.b * w.c + p.d * w.d
    const e = p.a * w.e + p.c * w.f + p.e
    const f = p.b * w.e + p.d * w.f + p.f
    o.a = a
    o.b = b
    o.c = c
    o.d = d
    o.e = e
    o.f = f
    return o
  }

  get viewport(): Rect {
    return this.#inset!.viewport
  }

  get frameNum(): number {
    return this.#outer!.frameNum
  }
}
