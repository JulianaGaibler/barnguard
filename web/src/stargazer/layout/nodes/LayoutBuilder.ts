/**
 * {@link LayoutBuilder}: a layout node that takes a slot in its parent's layout
 * but hands its resolved rect to freeform content instead of laying out a
 * measurable subtree. The escape hatch for putting content that positions
 * itself (a physics field, a grid drawn from its own geometry, a `domAnchor`ed
 * overlay) inside a {@link LayoutRoot} without making every node measurable.
 *
 * @module
 * @category Layout
 */
import { BoxConstraints, type Size } from '../constraints'
import { LayoutNode } from '../LayoutNode'
import type { Vec2 } from '../../math/Vec2'
import { rect, type Rect } from '../../math/Rect'

/**
 * Dev-only: warn when a builder sits on an unconstrained axis and measures to
 * 0.
 */
const DEV_WARN_UNCONSTRAINED = true

/**
 * Options for {@link LayoutBuilder}.
 *
 * @category Layout
 */
export interface LayoutBuilderOptions {
  /**
   * Called on every layout pass with the builder's resolved rect in world
   * coords. Use it to place freeform content (which typically lives as a scene
   * sibling, not a child of the builder). The rect is reused across passes, so
   * copy fields you need to keep.
   */
  onLayout?: (rect: Readonly<Rect>) => void
  /**
   * Fixed width; omit to fill a bounded (tight) width or measure to 0 when
   * loose.
   */
  width?: number
  /**
   * Fixed height; omit to fill a bounded (tight) height or measure to 0 when
   * loose.
   */
  height?: number
  /** Node id. */
  id?: string
}

/**
 * A leaf that reserves a layout slot and reports the rect it was arranged into,
 * without measuring or arranging anything below it. Its own subtree, if any, is
 * left untouched: draw into it or (more commonly) place a freeform scene
 * sibling from the reported rect.
 *
 * Sizing mirrors the discipline the flex children follow. On each axis the
 * builder fills a tight constraint (or a fixed `width`/`height`) and otherwise
 * measures to the constrained minimum, which is 0 under a loose box. So a bare
 * builder on the main axis of a {@link Row} or {@link Column} collapses to
 * nothing, the same way a {@link Spacer} would if it were not flexible. Give it
 * size by wrapping it: {@link Expanded} to take leftover space,
 * {@link AspectRatio} to fit a ratio, or {@link SizedBox} for a fixed box. As the
 * direct content of a {@link LayoutRoot} it fills the bounds (the root measures
 * tight).
 *
 * @category Layout
 * @example
 *   // A board that lays itself out from the rect the layout gives it:
 *   const slot = new LayoutBuilder({ onLayout: (r) => board.fit(r) })
 *   root.setContent(
 *     new Center({ child: new AspectRatio({ ratio: 1, child: slot }) }),
 *   )
 */
export class LayoutBuilder extends LayoutNode {
  readonly #onLayout?: (rect: Readonly<Rect>) => void
  readonly #width?: number
  readonly #height?: number
  // Reused across passes so a layout allocates nothing.
  readonly #rect: Rect = rect()
  readonly #tl: Vec2 = { x: 0, y: 0 }
  readonly #br: Vec2 = { x: 0, y: 0 }
  #warned = false

  constructor(opts: LayoutBuilderOptions = {}) {
    super(opts.id)
    this.#onLayout = opts.onLayout
    this.#width = opts.width
    this.#height = opts.height
  }

  /** The rect from the last layout pass, in world coords. */
  get contentRect(): Readonly<Rect> {
    return this.#rect
  }

  measure(c: BoxConstraints): Size {
    this.measuredSize.w = this.#axisSize(this.#width, c.minW, c.maxW, 'width')
    this.measuredSize.h = this.#axisSize(this.#height, c.minH, c.maxH, 'height')
    return this.measuredSize
  }

  arrange(x: number, y: number, w: number, h: number): void {
    this.transform.x = x
    this.transform.y = y
    this.debugBounds = { x: 0, y: 0, width: w, height: h }
    // arrange coords are parent-local; localToWorld recomposes the ancestor
    // chain on demand, so the world rect is correct here even though transform
    // propagation runs later in the frame.
    this.localToWorld(0, 0, this.#tl)
    this.localToWorld(w, h, this.#br)
    this.#rect.x = Math.min(this.#tl.x, this.#br.x)
    this.#rect.y = Math.min(this.#tl.y, this.#br.y)
    this.#rect.width = Math.abs(this.#br.x - this.#tl.x)
    this.#rect.height = Math.abs(this.#br.y - this.#tl.y)
    this.#onLayout?.(this.#rect)
  }

  #axisSize(
    hint: number | undefined,
    min: number,
    max: number,
    axis: 'width' | 'height',
  ): number {
    if (hint !== undefined) return Math.max(min, Math.min(hint, max))
    if (min === max) return max
    if (
      DEV_WARN_UNCONSTRAINED &&
      min === 0 &&
      max === Infinity &&
      !this.#warned
    ) {
      this.#warned = true
      console.warn(
        `[stargazer] LayoutBuilder('${this.id}') has an unconstrained ${axis} ` +
          `and measured to 0. Wrap it in Expanded, AspectRatio, or SizedBox.`,
      )
    }
    return min
  }
}
