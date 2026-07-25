/**
 * {@link Stack}: overlay children in the same box, one on top of the next in
 * child order, each placed by the stack's alignment.
 *
 * @module
 * @category Layout
 */
import type { SceneNode } from '../../scene/SceneNode'
import { BoxConstraints, type Size } from '../constraints'
import { LayoutNode, isMeasurable, type MeasurableNode } from '../LayoutNode'
import { alignOffset, type Align1D } from '../align'

/** Options for {@link Stack}. */
export interface StackOptions {
  /** Children, painted back to front in order. */
  children?: MeasurableNode[]
  /** Horizontal placement of each child. Default `'start'`. */
  alignX?: Align1D
  /** Vertical placement of each child. Default `'start'`. */
  alignY?: Align1D
  /**
   * `'loose'` (default) shrink-wraps the stack to its largest child; `'expand'`
   * fills the space the parent offers on any bounded axis.
   */
  fit?: 'loose' | 'expand'
}

/**
 * Overlays its children in a shared box. Children are measured loosely and
 * placed by `alignX` / `alignY` (a `'stretch'` axis fills the box). Use it for
 * badges over a thumbnail, a scrim over content, or any layered composition.
 *
 * @category Layout
 * @example
 *   new Stack({
 *     alignX: 'end',
 *     alignY: 'start',
 *     children: [thumbnail, unreadBadge],
 *   })
 */
export class Stack extends LayoutNode {
  alignX: Align1D
  alignY: Align1D
  fit: 'loose' | 'expand'
  readonly #cc = new BoxConstraints()
  #items: MeasurableNode[] = []
  #w: number[] = []
  #h: number[] = []

  constructor(opts: StackOptions = {}) {
    super()
    this.alignX = opts.alignX ?? 'start'
    this.alignY = opts.alignY ?? 'start'
    this.fit = opts.fit ?? 'loose'
    if (opts.children) this.add(...opts.children)
  }

  /** Append one or more children and schedule a relayout. */
  override add(...children: SceneNode[]): this {
    super.add(...children)
    this.markLayoutDirty()
    return this
  }

  /** Remove one or more children (not destroyed) and schedule a relayout. */
  override remove(...children: SceneNode[]): this {
    super.remove(...children)
    this.markLayoutDirty()
    return this
  }

  measure(constraints: BoxConstraints): Size {
    const items = (this.#items = this._children.filter(
      isMeasurable,
    ) as MeasurableNode[])
    const n = items.length
    if (this.#w.length < n) {
      this.#w = new Array<number>(n)
      this.#h = new Array<number>(n)
    }
    this.#cc.set(0, constraints.maxW, 0, constraints.maxH)
    let maxW = 0
    let maxH = 0
    for (let i = 0; i < n; i++) {
      const s = items[i].measure(this.#cc)
      this.#w[i] = s.w
      this.#h[i] = s.h
      if (s.w > maxW) maxW = s.w
      if (s.h > maxH) maxH = s.h
    }
    const expand = this.fit === 'expand'
    this.measuredSize.w = constraints.constrainW(
      expand && constraints.hasBoundedW ? constraints.maxW : maxW,
    )
    this.measuredSize.h = constraints.constrainH(
      expand && constraints.hasBoundedH ? constraints.maxH : maxH,
    )
    return this.measuredSize
  }

  arrange(x: number, y: number, w: number, h: number): void {
    this.transform.x = x
    this.transform.y = y
    this.debugBounds = { x: 0, y: 0, width: w, height: h }
    const items = this.#items
    for (let i = 0; i < items.length; i++) {
      const cw = this.alignX === 'stretch' ? w : this.#w[i]
      const ch = this.alignY === 'stretch' ? h : this.#h[i]
      const cx =
        this.alignX === 'stretch' ? 0 : alignOffset(this.alignX, w - cw)
      const cy =
        this.alignY === 'stretch' ? 0 : alignOffset(this.alignY, h - ch)
      items[i].arrange(cx, cy, cw, ch)
    }
  }
}
