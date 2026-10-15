import { Node2D } from '../scene/Node2D'
import { definePaintProps } from '../render/picture/paintProps'
import type { Canvas } from '../render/picture/Canvas'
import type { Vec2 } from '../math/Vec2'

/**
 * How a {@link PolylineNode} renders between points: `'none'` draws straight
 * segments, `'quadratic'` fits a smooth Bézier through the samples.
 */
export type PolylineSmoothing = 'none' | 'quadratic'

/** Constructor options for {@link PolylineNode}. */
export interface PolylineNodeOptions {
  id?: string
  /** Initial buffer capacity in _points_ (each point is 2 floats). Default 128. */
  capacity?: number
  /** Stroke color (any CSS color). Default `'#fdf6e3'`. */
  strokeStyle?: string
  /** Stroke width in `strokeSpace` units. Default 2. */
  lineWidth?: number
  /** Corner style between segments. Default `'round'`. */
  lineJoin?: CanvasLineJoin
  /** End-cap style. Default `'round'`. */
  lineCap?: CanvasLineCap
  /** Point-to-point interpolation. Default `'none'`. */
  smoothing?: PolylineSmoothing
  /**
   * `'screen'` (default), `lineWidth` is a CSS-pixel value that stays visually
   * constant across camera zoom. Opt into `'world'` for a stroke whose
   * thickness scales with the camera.
   */
  strokeSpace?: 'screen' | 'world'
}

/**
 * Append-only polyline in world coords, backed by a `Float32Array` that doubles
 * on overflow. Optimised for the finger-drawn-path use case: hot `push` with no
 * per-point allocation, cheap `endPoint` access for game behaviors to hit-test
 * the drawing tip.
 *
 * `smoothing: 'quadratic'` renders each pair of consecutive points as a
 * quadratic-Bézier curve using the point as the control and the midpoint to the
 * next point as the on-curve anchor, so a jaggy multi-touch sample stream draws
 * as a smooth path with no post-processing.
 *
 * @example
 *   const trail = new PolylineNode({
 *     strokeStyle: '#4ade80',
 *     lineWidth: 3,
 *     smoothing: 'quadratic',
 *   })
 *   scene.root.add(trail)
 *   // On each pointer move, extend the path, skipping near-duplicate samples.
 *   trail.pushIfFar(worldX, worldY, 4)
 */
export class PolylineNode extends Node2D {
  // Live mirrors of PolylineNodeOptions, documented there. Each is a paint
  // property, so writing a new value repaints the node. Points go through
  // `push`/`clear`, not a public array, and each of those repaints it too.
  declare strokeStyle: string
  declare lineWidth: number
  declare lineJoin: CanvasLineJoin
  declare lineCap: CanvasLineCap
  declare smoothing: PolylineSmoothing
  declare strokeSpace: 'screen' | 'world'

  #data: Float32Array
  #count = 0
  readonly #cachedEnd: Vec2 = { x: 0, y: 0 }

  constructor(opts: PolylineNodeOptions = {}) {
    super(opts.id)
    definePaintProps(this, {
      strokeStyle: opts.strokeStyle ?? '#fdf6e3',
      lineWidth: opts.lineWidth ?? 2,
      lineJoin: opts.lineJoin ?? ('round' as CanvasLineJoin),
      lineCap: opts.lineCap ?? ('round' as CanvasLineCap),
      smoothing: opts.smoothing ?? ('none' as PolylineSmoothing),
      strokeSpace: opts.strokeSpace ?? ('screen' as 'screen' | 'world'),
    })
    const cap = Math.max(2, opts.capacity ?? 128)
    this.#data = new Float32Array(cap * 2)
  }

  get pointCount(): number {
    return this.#count
  }

  get capacity(): number {
    return this.#data.length / 2
  }

  /**
   * Last stored point in world coords, or `null` if empty. Returned as a reused
   * `Vec2`, game code MUST NOT hold onto it across frames.
   */
  get endPoint(): Readonly<Vec2> | null {
    if (this.#count === 0) return null
    const i = (this.#count - 1) * 2
    this.#cachedEnd.x = this.#data[i]
    this.#cachedEnd.y = this.#data[i + 1]
    return this.#cachedEnd
  }

  /** Append a point to the end of the polyline. Returns `this` for chaining. */
  push(x: number, y: number): this {
    if (this.#count * 2 >= this.#data.length) this.#grow()
    const i = this.#count * 2
    this.#data[i] = x
    this.#data[i + 1] = y
    this.#count++
    this.markNeedsPaint()
    return this
  }

  /** Push only if the new point is farther than `minWorldDist` from the last. */
  pushIfFar(x: number, y: number, minWorldDist: number): boolean {
    if (this.#count > 0) {
      const li = (this.#count - 1) * 2
      const dx = x - this.#data[li]
      const dy = y - this.#data[li + 1]
      if (dx * dx + dy * dy < minWorldDist * minWorldDist) return false
    }
    this.push(x, y)
    return true
  }

  /** Remove all points. Returns `this` for chaining. */
  clear(): this {
    this.#count = 0
    this.markNeedsPaint()
    return this
  }

  /**
   * Drop the first `count` points from the head of the polyline, used to
   * "consume" a drawn path behind a moving object (a trail that shortens from
   * the tail). `copyWithin` shifts the tail down in-place, zero allocations per
   * call. `pointCount` reduces by `count`.
   *
   * Clamps to `[0, pointCount]`, a caller can safely pass any non-negative
   * integer without bounds-checking. Returns `this` for chaining.
   */
  dropHead(count: number): this {
    if (count <= 0) return this
    const clamped = Math.min(count, this.#count)
    const remaining = this.#count - clamped
    if (remaining > 0) {
      // Shift [clamped*2, count*2) down to [0, remaining*2).
      this.#data.copyWithin(0, clamped * 2, this.#count * 2)
    }
    this.#count = remaining
    this.markNeedsPaint()
    return this
  }

  pointAt(i: number, out?: Vec2): Vec2 {
    if (i < 0 || i >= this.#count)
      throw new RangeError(`Polyline index out of range: ${i}`)
    const base = i * 2
    if (out) {
      out.x = this.#data[base]
      out.y = this.#data[base + 1]
      return out
    }
    return { x: this.#data[base], y: this.#data[base + 1] }
  }

  /**
   * In-place update of the point at index `i`. Used by subclasses that
   * post-process pushed points (e.g., corner-smoothing an incoming finger
   * path). Returns `this` for chaining.
   */
  setPoint(i: number, x: number, y: number): this {
    if (i < 0 || i >= this.#count)
      throw new RangeError(`Polyline index out of range: ${i}`)
    const base = i * 2
    this.#data[base] = x
    this.#data[base + 1] = y
    this.markNeedsPaint()
    return this
  }

  /** Copy a range of points as a new Float32Array (`[x0, y0, x1, y1, …]`). */
  slice(from = 0, to = this.#count): Float32Array {
    if (from < 0 || to > this.#count || from > to) {
      throw new RangeError('Polyline slice: bad range')
    }
    return this.#data.slice(from * 2, to * 2)
  }

  /**
   * Ramer-Douglas-Peucker simplification. Reduces jitter without changing the
   * overall shape. Rarely needed at runtime, useful for saving a completed
   * drawing. Returns `this` for chaining.
   */
  simplify(toleranceWorld: number): this {
    if (this.#count < 3) return this
    const kept = rdp(this.#data, this.#count, toleranceWorld)
    for (let i = 0; i < kept.length; i++) {
      const src = kept[i] * 2
      const dst = i * 2
      if (src !== dst) {
        this.#data[dst] = this.#data[src]
        this.#data[dst + 1] = this.#data[src + 1]
      }
    }
    this.#count = kept.length
    this.markNeedsPaint()
    return this
  }

  override paint(gfx: Canvas): void {
    if (this.#count < 2) return
    // Midpoint smoothing lives in the gfx backend's stroke program. A screen
    // width resolves at replay, so zooming does not repaint the node.
    gfx.strokePolyline(this.#data, this.#count, {
      color: this.strokeStyle,
      width:
        this.strokeSpace === 'world'
          ? this.lineWidth
          : { screen: this.lineWidth },
      join: this.lineJoin,
      cap: this.lineCap,
      smoothing: this.smoothing,
    })
  }

  #grow(): void {
    const next = new Float32Array(this.#data.length * 2)
    next.set(this.#data)
    this.#data = next
  }
}

/**
 * RDP, returns an array of indices (into the point list) that remain after
 * simplification. Iterative (avoids recursion depth on long paths).
 */
function rdp(data: Float32Array, count: number, tolerance: number): number[] {
  const keep = new Uint8Array(count)
  keep[0] = 1
  keep[count - 1] = 1
  const stack: Array<[number, number]> = [[0, count - 1]]
  const tol2 = tolerance * tolerance
  while (stack.length > 0) {
    const [lo, hi] = stack.pop()!
    let maxDist = 0
    let maxIdx = -1
    const ax = data[lo * 2],
      ay = data[lo * 2 + 1]
    const bx = data[hi * 2],
      by = data[hi * 2 + 1]
    const dx = bx - ax,
      dy = by - ay
    const denom = dx * dx + dy * dy
    for (let i = lo + 1; i < hi; i++) {
      const px = data[i * 2],
        py = data[i * 2 + 1]
      let d2: number
      if (denom === 0) {
        const ex = px - ax
        const ey = py - ay
        d2 = ex * ex + ey * ey
      } else {
        const t = ((px - ax) * dx + (py - ay) * dy) / denom
        const cx = ax + t * dx
        const cy = ay + t * dy
        const ex = px - cx
        const ey = py - cy
        d2 = ex * ex + ey * ey
      }
      if (d2 > maxDist) {
        maxDist = d2
        maxIdx = i
      }
    }
    if (maxIdx !== -1 && maxDist > tol2) {
      keep[maxIdx] = 1
      stack.push([lo, maxIdx])
      stack.push([maxIdx, hi])
    }
  }
  const result: number[] = []
  for (let i = 0; i < count; i++) if (keep[i] === 1) result.push(i)
  return result
}
