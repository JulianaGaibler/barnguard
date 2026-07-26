/**
 * {@link AspectRatio}: size a child to a width/height ratio, fitting the largest
 * such box inside the offered space and aligning it within.
 *
 * @module
 * @category Layout
 */
import { BoxConstraints, type Size } from '../constraints'
import { LayoutNode, type MeasurableNode } from '../LayoutNode'
import { alignOffset, type Align1D } from '../align'

/**
 * Options for {@link AspectRatio}.
 *
 * @category Layout
 */
export interface AspectRatioOptions {
  /** Width divided by height. 1 is a square. */
  ratio: number
  /** The child, sized to the ratio box. */
  child: MeasurableNode
  /** Horizontal placement within the offered space. Default `'center'`. */
  alignX?: Align1D
  /** Vertical placement within the offered space. Default `'center'`. */
  alignY?: Align1D
}

/**
 * Fits the largest `ratio` box inside the space its parent offers and places
 * the child in it. A ratio-1 `AspectRatio` around a board keeps the board
 * square as the window changes shape.
 *
 * The reported size still obeys the incoming constraints: under a tight box it
 * returns the tight size (and the ratio box, which may be smaller, is where the
 * child sits), so a parent's min/tight bounds are never violated. The ratio box
 * is recomputed from the size actually granted in `arrange`, so nothing is
 * carried between the two calls.
 *
 * @category Layout
 * @example
 *   new AspectRatio({ ratio: 1, child: board })
 */
export class AspectRatio extends LayoutNode {
  ratio: number
  alignX: Align1D
  alignY: Align1D
  readonly #child: MeasurableNode
  readonly #cc = new BoxConstraints()
  readonly #box: Size = { w: 0, h: 0 }

  constructor(opts: AspectRatioOptions) {
    super()
    this.ratio = opts.ratio
    this.alignX = opts.alignX ?? 'center'
    this.alignY = opts.alignY ?? 'center'
    this.#child = opts.child
    this.add(opts.child)
  }

  measure(c: BoxConstraints): Size {
    if (!c.hasBoundedW && !c.hasBoundedH) {
      throw new Error(
        `[stargazer] layout: AspectRatio('${this.id}') has no bounded axis to ` +
          `fit its ratio into. Give it a bounded width or height.`,
      )
    }
    const box = this.#ratioBox(c.maxW, c.maxH)
    // Measure the child tight to the ratio box, then report a size that still
    // satisfies the incoming constraints (a tight parent gets its tight size).
    BoxConstraints.tight(box.w, box.h, this.#cc)
    this.#child.measure(this.#cc)
    this.measuredSize.w = c.constrainW(box.w)
    this.measuredSize.h = c.constrainH(box.h)
    return this.measuredSize
  }

  arrange(x: number, y: number, w: number, h: number): void {
    this.transform.x = x
    this.transform.y = y
    this.debugBounds = { x: 0, y: 0, width: w, height: h }
    const box = this.#ratioBox(w, h)
    const cx = alignOffset(this.alignX, w - box.w)
    const cy = alignOffset(this.alignY, h - box.h)
    this.#child.arrange(cx, cy, box.w, box.h)
  }

  // Largest box of `ratio` fitting within `maxW`×`maxH`; the bounded axis wins.
  // Writes into the reused `#box` so a layout pass allocates nothing.
  #ratioBox(maxW: number, maxH: number): Size {
    let w = Number.isFinite(maxW) ? maxW : maxH * this.ratio
    let h = w / this.ratio
    if (h > maxH) {
      h = maxH
      w = h * this.ratio
    }
    this.#box.w = w
    this.#box.h = h
    return this.#box
  }
}
