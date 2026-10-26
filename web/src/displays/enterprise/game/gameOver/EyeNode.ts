import {
  Node2D,
  definePaintProps,
  type Canvas,
  type Rect,
} from 'stargazer'

export interface EyeNodeOptions {
  /**
   * The pre-centred, pre-scaled eye outline path. `(0, 0)` in the path's local
   * coords must be the eye's visual centre so the node's `transform.x/y` places
   * that centre directly.
   */
  outlinePath: Path2D
  /** Local-space AABB of `outlinePath` for iris clamping. */
  outlineBounds: Rect
  /**
   * Iris disc radius (world units). ~1/3 of the shortest eye axis reads
   * "close-up cartoon eye", smaller reads spooky-beady.
   */
  irisRadius: number
  /**
   * How far (world units) the iris can shift from the eye's centre before it
   * would poke through the lid. Clamped to a fraction of the shortest half-axis
   * so the iris always fits inside the outline.
   */
  irisMaxOffset: number
  /** Eye body fill. */
  outlineFill: string
  /** Iris fill. */
  irisFill: string
}

/**
 * The eyes that stare at the escaping packet on the game-over card's loss
 * animation. Combines the two-path SVG (`top` + `bottom` lids) into one
 * pre-centred `Path2D` for the body, and draws a filled disc iris on top that
 * slides toward the direction `(lookDx, lookDy)`.
 *
 * Two independent scalars drive the reveal:
 *
 * - `openAmount`, vertical scale on the outline (0 = closed, 1 = fully open).
 *   Tweened by the scene on spawn + blinks.
 * - `irisFocusAmount`, 0 = iris centred, 1 = iris pushed to `irisMaxOffset` along
 *   the direction of `(lookDx, lookDy)`. Split from `openAmount` so the iris
 *   can visibly _slide_ into focus AFTER the lid opens, rather than
 *   hard-pinning on the first frame the eye is visible (the eye is rigidly
 *   anchored to the packet, so its `dx/dy` to the packet stay constant across
 *   frames).
 *
 * Not hit-enabled. Not driven by any behavior, the scene owns the tween
 * lifecycle directly.
 */
export class EyeNode extends Node2D {
  readonly #outlinePath: Path2D
  readonly #outlineHalfWidth: number
  readonly #outlineHalfHeight: number
  readonly #irisRadius: number
  readonly #irisMaxOffset: number
  readonly #outlineFill: string
  readonly #irisFill: string

  /** 0..1, vertical scale on the outline. Scene tweens this on spawn. */
  declare openAmount: number
  /**
   * 0..1, the iris slide toward the look direction. Scene tweens 0 -> 1 AFTER
   * the lid finishes opening so the pupil visibly drifts to focus.
   */
  declare irisFocusAmount: number
  /**
   * Vector from the eye's centre toward what it looks at, in world units. Only
   * its direction matters. The eye rides rigidly with its target, so the scene
   * writes it once.
   */
  declare lookDx: number
  declare lookDy: number

  constructor(opts: EyeNodeOptions) {
    super('eye')
    definePaintProps(this, {
      openAmount: 0,
      irisFocusAmount: 0,
      lookDx: 0,
      lookDy: 0,
    })
    this.#outlinePath = opts.outlinePath
    this.#outlineHalfWidth = opts.outlineBounds.width / 2
    this.#outlineHalfHeight = opts.outlineBounds.height / 2
    this.#irisRadius = opts.irisRadius
    // Clamp to something sane in case the caller passes a giant offset.
    this.#irisMaxOffset = Math.min(
      opts.irisMaxOffset,
      this.#outlineHalfWidth - this.#irisRadius,
      this.#outlineHalfHeight - this.#irisRadius,
    )
    this.#outlineFill = opts.outlineFill
    this.#irisFill = opts.irisFill
  }

  override paint(gfx: Canvas): void {
    if (this.openAmount <= 0.001) return
    gfx.save()
    // Squash the lid open along Y only, reads as a lid raising rather
    // than the whole eye scaling in. The outline path is pre-centred so
    // (0, 0) is the eye's visual centre, and the Y-scale keeps that
    // centre pinned.
    gfx.scale(1, this.openAmount)
    gfx.fillPath2D(this.#outlinePath, this.#outlineFill)

    // Iris offset, direction from eye centre toward the look vector,
    // multiplied by `irisMaxOffset` and by `irisFocusAmount` so the
    // pupil animates INTO focus. Un-scale Y so the iris sits round
    // inside the (currently squashed) eye rather than mirroring the
    // lid's stretch.
    const dx = this.lookDx
    const dy = this.lookDy
    const len = Math.hypot(dx, dy) || 1
    const focus = this.irisFocusAmount
    const ox = (dx / len) * this.#irisMaxOffset * focus
    // Compensate the outer Y scale so the iris's Y position tracks the
    // world direction rather than being squashed with the lid.
    const oy =
      ((dy / len) * this.#irisMaxOffset * focus) /
      Math.max(this.openAmount, 0.001)
    gfx.fillCircle(ox, oy, this.#irisRadius, this.#irisFill)
    gfx.restore()
  }
}
