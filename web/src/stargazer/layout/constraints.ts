/**
 * Box-layout geometry: a {@link Size}, {@link EdgeInsets}, and the
 * {@link BoxConstraints} a parent hands each child while laying out.
 *
 * @module
 * @category Layout
 */

/**
 * A width/height pair in world units.
 *
 * A layout node keeps ONE preallocated `Size` as its `measuredSize` and writes
 * into it during `measure`, so a layout pass allocates nothing. Because the
 * object is reused, copy `w`/`h` into locals if you need to keep a value across
 * another `measure` call.
 *
 * @category Layout
 */
export interface Size {
  w: number
  h: number
}

/**
 * Per-edge spacing in world units, used for padding and alignment insets. Build
 * one with {@link edgeInsets} rather than the object literal.
 *
 * @category Layout
 */
export interface EdgeInsets {
  left: number
  top: number
  right: number
  bottom: number
}

/**
 * Build {@link EdgeInsets} the CSS-shorthand way.
 *
 * - `edgeInsets(16)` insets all four edges by 16.
 * - `edgeInsets(8, 24)` uses 8 for top/bottom, 24 for left/right.
 * - `edgeInsets(4, 8, 12, 16)` sets top, right, bottom, left in that order.
 *
 * @category Layout
 * @example
 *   new Padding({ insets: edgeInsets(24), child: label })
 */
export function edgeInsets(
  a: number,
  b?: number,
  c?: number,
  d?: number,
): EdgeInsets {
  if (b === undefined) return { top: a, right: a, bottom: a, left: a }
  if (c === undefined) return { top: a, right: b, bottom: a, left: b }
  return { top: a, right: b, bottom: c ?? a, left: d ?? b }
}

/**
 * The minimum and maximum width and height a parent allows a child, passed into
 * {@link Measurable.measure}. The child must return a {@link Size} within these
 * bounds. `maxW`/`maxH` may be `Infinity` for an unbounded axis (for example
 * the scroll direction of a list); a child measured on an unbounded axis must
 * size to its own content and must never read `maxW`/`maxH` there.
 *
 * @category Layout
 * @example
 *   // Give a child a fixed 200×80 box, then measure it.
 *   const c = new BoxConstraints()
 *   BoxConstraints.tight(200, 80, c)
 *   const size = child.measure(c)
 *
 *   Instances are mutable and are meant to be reused across a layout pass rather
 *   than allocated per node, so the pass does not churn the GC. A container builds
 *   each child's constraints by mutating a scratch instance it owns
 *   ({@link BoxConstraints.set} / {@link BoxConstraints.tight} /
 *   {@link BoxConstraints.loose} / {@link BoxConstraints.deflate}) and must not
 *   retain the constraints object it received, since its own parent will overwrite
 *   it for the next sibling.
 */
export class BoxConstraints {
  minW = 0
  maxW = Infinity
  minH = 0
  maxH = Infinity

  /** Overwrite all four bounds and return `this`. */
  set(minW: number, maxW: number, minH: number, maxH: number): this {
    this.minW = minW
    this.maxW = maxW
    this.minH = minH
    this.maxH = maxH
    return this
  }

  /** Copy another instance's bounds into `this` and return `this`. */
  copyFrom(o: BoxConstraints): this {
    return this.set(o.minW, o.maxW, o.minH, o.maxH)
  }

  /** Clamp a width into `[minW, maxW]`. */
  constrainW(w: number): number {
    return Math.max(this.minW, Math.min(w, this.maxW))
  }

  /** Clamp a height into `[minH, maxH]`. */
  constrainH(h: number): number {
    return Math.max(this.minH, Math.min(h, this.maxH))
  }

  /** Clamp a size into range, writing into `out` and returning it. */
  constrain(w: number, h: number, out: Size): Size {
    out.w = this.constrainW(w)
    out.h = this.constrainH(h)
    return out
  }

  /** Whether the width axis is bounded (a finite `maxW`). */
  get hasBoundedW(): boolean {
    return Number.isFinite(this.maxW)
  }

  /** Whether the height axis is bounded (a finite `maxH`). */
  get hasBoundedH(): boolean {
    return Number.isFinite(this.maxH)
  }

  /**
   * Shrink the available space by `insets` (for a padding container), writing
   * the reduced constraints into `out` and returning it. Bounded maxima drop by
   * the inset totals (floored at 0); an unbounded axis stays unbounded.
   */
  deflate(insets: EdgeInsets, out: BoxConstraints): BoxConstraints {
    const h = insets.left + insets.right
    const v = insets.top + insets.bottom
    out.maxW = this.hasBoundedW ? Math.max(0, this.maxW - h) : Infinity
    out.maxH = this.hasBoundedH ? Math.max(0, this.maxH - v) : Infinity
    out.minW = Math.min(Math.max(0, this.minW - h), out.maxW)
    out.minH = Math.min(Math.max(0, this.minH - v), out.maxH)
    return out
  }

  /**
   * Set `out` (or a fresh instance) to a tight box: `min === max` on both axes,
   * so the child is forced to exactly `w × h`.
   */
  static tight(
    w: number,
    h: number,
    out = new BoxConstraints(),
  ): BoxConstraints {
    return out.set(w, w, h, h)
  }

  /**
   * Set `out` (or a fresh instance) to a loose box: zero minimum, the given
   * maxima, so the child may be any size up to `maxW × maxH`.
   */
  static loose(
    maxW: number,
    maxH: number,
    out = new BoxConstraints(),
  ): BoxConstraints {
    return out.set(0, maxW, 0, maxH)
  }
}
