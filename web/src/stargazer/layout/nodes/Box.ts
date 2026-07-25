/**
 * Single-child boxes: {@link Box} (size + padding, stretches its child to fill),
 * the {@link SizedBox} and {@link Padding} conveniences, and {@link Align} /
 * {@link Center} (fill the available space and place a child within it).
 *
 * @module
 * @category Layout
 */
import {
  BoxConstraints,
  edgeInsets,
  type EdgeInsets,
  type Size,
} from '../constraints'
import { LayoutNode, type MeasurableNode } from '../LayoutNode'
import { alignOffset, type Align1D } from '../align'

export type { Align1D }

/** Options for {@link Box}. */
export interface BoxOptions {
  /** Fixed outer width. Omit to shrink-wrap to the child (plus padding). */
  width?: number
  /** Fixed outer height. Omit to shrink-wrap to the child (plus padding). */
  height?: number
  /** Inner padding between the box edge and the child. */
  padding?: EdgeInsets
  /** The single child, stretched to fill the padded interior. */
  child?: MeasurableNode
}

/**
 * A single-child container with optional fixed size and padding. The child is
 * stretched to fill the interior (the box minus padding); with no `width` or
 * `height` the box shrink-wraps to the child plus padding. To place a smaller
 * child within a larger area, use {@link Align} or {@link Center}.
 *
 * @category Layout
 * @example
 *   new Box({
 *     width: 480,
 *     padding: edgeInsets(24),
 *     child: new Column({ children: [title, body] }),
 *   })
 */
export class Box extends LayoutNode {
  width?: number
  height?: number
  padding: EdgeInsets
  #child: MeasurableNode | null
  readonly #cc = new BoxConstraints()

  constructor(opts: BoxOptions = {}) {
    super()
    this.width = opts.width
    this.height = opts.height
    this.padding = opts.padding ?? edgeInsets(0)
    this.#child = opts.child ?? null
    if (this.#child) this.add(this.#child)
  }

  /** Replace the child (removed, not destroyed) and schedule a relayout. */
  setChild(child: MeasurableNode | null): void {
    if (this.#child && this.#child !== child) this.remove(this.#child)
    this.#child = child
    if (child && child.parent !== this) this.add(child)
    this.markLayoutDirty()
  }

  measure(constraints: BoxConstraints): Size {
    const p = this.padding
    const ph = p.left + p.right
    const pv = p.top + p.bottom
    const hasW = this.width !== undefined
    const hasH = this.height !== undefined

    const availMaxW = Number.isFinite(constraints.maxW)
      ? Math.max(0, constraints.maxW - ph)
      : Infinity
    const availMaxH = Number.isFinite(constraints.maxH)
      ? Math.max(0, constraints.maxH - pv)
      : Infinity
    const contentW = hasW ? Math.max(0, this.width! - ph) : undefined
    const contentH = hasH ? Math.max(0, this.height! - pv) : undefined

    // A definite axis constrains the child tightly (it fills the interior); an
    // indefinite axis is loose so the box can shrink-wrap.
    this.#cc.set(
      contentW ?? 0,
      contentW ?? availMaxW,
      contentH ?? 0,
      contentH ?? availMaxH,
    )
    const s = this.#child?.measure(this.#cc) ?? { w: 0, h: 0 }

    this.measuredSize.w = constraints.constrainW(hasW ? this.width! : s.w + ph)
    this.measuredSize.h = constraints.constrainH(hasH ? this.height! : s.h + pv)
    return this.measuredSize
  }

  arrange(x: number, y: number, w: number, h: number): void {
    this.transform.x = x
    this.transform.y = y
    this.debugBounds = { x: 0, y: 0, width: w, height: h }
    const p = this.padding
    this.#child?.arrange(
      p.left,
      p.top,
      Math.max(0, w - p.left - p.right),
      Math.max(0, h - p.top - p.bottom),
    )
  }
}

/**
 * A fixed-size box: `new SizedBox({ width, height })`. With a child, the child
 * fills it; without one, it reserves blank space of that size.
 *
 * @category Layout
 */
export class SizedBox extends Box {
  constructor(opts: { width: number; height: number; child?: MeasurableNode }) {
    super(opts)
  }
}

/**
 * Pad a child on every edge: `new Padding({ insets: edgeInsets(16), child })`.
 * Shrink-wraps to the child plus the insets.
 *
 * @category Layout
 */
export class Padding extends Box {
  constructor(opts: { insets: EdgeInsets; child: MeasurableNode }) {
    super({ padding: opts.insets, child: opts.child })
  }
}

/** Options for {@link Align}. */
export interface AlignOptions {
  child: MeasurableNode
  /** Horizontal placement. Default `'center'`. */
  alignX?: Align1D
  /** Vertical placement. Default `'center'`. */
  alignY?: Align1D
}

/**
 * Fills the space its parent offers and places a single child within it by
 * `alignX` / `alignY`. Use it to center or corner-pin content in a larger area;
 * {@link Center} is the centered shorthand.
 *
 * @category Layout
 * @example
 *   new Align({ alignX: 'end', alignY: 'start', child: closeButton })
 */
export class Align extends LayoutNode {
  alignX: Align1D
  alignY: Align1D
  readonly #child: MeasurableNode
  readonly #cc = new BoxConstraints()
  #childW = 0
  #childH = 0

  constructor(opts: AlignOptions) {
    super()
    this.alignX = opts.alignX ?? 'center'
    this.alignY = opts.alignY ?? 'center'
    this.#child = opts.child
    this.add(opts.child)
  }

  measure(constraints: BoxConstraints): Size {
    const stretchX = this.alignX === 'stretch'
    const stretchY = this.alignY === 'stretch'
    // Loose so the child keeps its natural size, unless an axis is stretched.
    this.#cc.set(
      stretchX && constraints.hasBoundedW ? constraints.maxW : 0,
      constraints.maxW,
      stretchY && constraints.hasBoundedH ? constraints.maxH : 0,
      constraints.maxH,
    )
    const s = this.#child.measure(this.#cc)
    this.#childW = s.w
    this.#childH = s.h
    // Fill each bounded axis; fall back to the child's size when unbounded.
    this.measuredSize.w = constraints.hasBoundedW
      ? constraints.maxW
      : constraints.constrainW(s.w)
    this.measuredSize.h = constraints.hasBoundedH
      ? constraints.maxH
      : constraints.constrainH(s.h)
    return this.measuredSize
  }

  arrange(x: number, y: number, w: number, h: number): void {
    this.transform.x = x
    this.transform.y = y
    this.debugBounds = { x: 0, y: 0, width: w, height: h }
    const cw = this.alignX === 'stretch' ? w : this.#childW
    const ch = this.alignY === 'stretch' ? h : this.#childH
    const cx = this.alignX === 'stretch' ? 0 : alignOffset(this.alignX, w - cw)
    const cy = this.alignY === 'stretch' ? 0 : alignOffset(this.alignY, h - ch)
    this.#child.arrange(cx, cy, cw, ch)
  }
}

/**
 * Centers a single child in the space its parent offers.
 *
 * @category Layout
 * @example
 *   root.setContent(new Center({ child: board }))
 */
export class Center extends Align {
  constructor(opts: { child: MeasurableNode }) {
    super({ child: opts.child, alignX: 'center', alignY: 'center' })
  }
}
