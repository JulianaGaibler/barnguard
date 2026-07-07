import { SceneNode } from '../scene/SceneNode'
import type { Camera } from '../camera/Camera'
import type { Vec2 } from '../math/Vec2'
import type { Gfx2D } from '../render/gfx/Gfx2D'

export type PolylineSmoothing = 'none' | 'quadratic'

export interface PolylineNodeOptions {
  id?: string
  /** Initial buffer capacity in _points_ (each point is 2 floats). Default 128. */
  capacity?: number
  strokeStyle?: string
  lineWidth?: number
  lineJoin?: CanvasLineJoin
  lineCap?: CanvasLineCap
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
 * per-point allocation, cheap `endPoint` access for game behaviours to hit-test
 * the drawing tip.
 *
 * `smoothing: 'quadratic'` renders each pair of consecutive points as a
 * quadratic-Bézier curve using the point as the control and the midpoint to the
 * next point as the on-curve anchor, buttery-smooth flight paths from jaggy
 * multi-touch samples with no post-processing.
 */
export class PolylineNode extends SceneNode {
  strokeStyle: string
  lineWidth: number
  lineJoin: CanvasLineJoin
  lineCap: CanvasLineCap
  smoothing: PolylineSmoothing
  strokeSpace: 'screen' | 'world'

  private data: Float32Array
  private count = 0
  private readonly cachedEnd: Vec2 = { x: 0, y: 0 }

  constructor(opts: PolylineNodeOptions = {}) {
    super(opts.id)
    this.strokeStyle = opts.strokeStyle ?? '#fdf6e3'
    this.lineWidth = opts.lineWidth ?? 2
    this.lineJoin = opts.lineJoin ?? 'round'
    this.lineCap = opts.lineCap ?? 'round'
    this.smoothing = opts.smoothing ?? 'none'
    this.strokeSpace = opts.strokeSpace ?? 'screen'
    const cap = Math.max(2, opts.capacity ?? 128)
    this.data = new Float32Array(cap * 2)
  }

  get pointCount(): number {
    return this.count
  }

  get capacity(): number {
    return this.data.length / 2
  }

  /**
   * Last stored point in world coords, or `null` if empty. Returned as a reused
   * `Vec2`, game code MUST NOT hold onto it across frames.
   */
  get endPoint(): Readonly<Vec2> | null {
    if (this.count === 0) return null
    const i = (this.count - 1) * 2
    this.cachedEnd.x = this.data[i]
    this.cachedEnd.y = this.data[i + 1]
    return this.cachedEnd
  }

  push(x: number, y: number): void {
    if (this.count * 2 >= this.data.length) this.grow()
    const i = this.count * 2
    this.data[i] = x
    this.data[i + 1] = y
    this.count++
    this.expandDebugBounds(x, y)
  }

  /** Push only if the new point is farther than `minWorldDist` from the last. */
  pushIfFar(x: number, y: number, minWorldDist: number): boolean {
    if (this.count > 0) {
      const li = (this.count - 1) * 2
      const dx = x - this.data[li]
      const dy = y - this.data[li + 1]
      if (dx * dx + dy * dy < minWorldDist * minWorldDist) return false
    }
    this.push(x, y)
    return true
  }

  clear(): void {
    this.count = 0
    this.debugBounds = null
  }

  /**
   * Drop the first `count` points from the head of the polyline, used to
   * "consume" a drawn path behind a moving object (e.g., a packet flying along
   * its trail). `copyWithin` shifts the tail down in-place; zero allocations
   * per call. `pointCount` reduces by `count`; `debugBounds` is invalidated
   * (recomputed lazily by the next draw or hit test).
   *
   * Clamps to `[0, pointCount]`, a caller can safely pass any non-negative
   * integer without bounds-checking.
   */
  dropHead(count: number): void {
    if (count <= 0) return
    const clamped = Math.min(count, this.count)
    const remaining = this.count - clamped
    if (remaining > 0) {
      // Shift [clamped*2, count*2) down to [0, remaining*2).
      this.data.copyWithin(0, clamped * 2, this.count * 2)
    }
    this.count = remaining
    this.debugBounds = null
  }

  pointAt(i: number, out?: Vec2): Vec2 {
    if (i < 0 || i >= this.count)
      throw new RangeError(`Polyline index out of range: ${i}`)
    const base = i * 2
    if (out) {
      out.x = this.data[base]
      out.y = this.data[base + 1]
      return out
    }
    return { x: this.data[base], y: this.data[base + 1] }
  }

  /**
   * In-place update of the point at index `i`. Used by subclasses that
   * post-process pushed points (e.g., corner-smoothing an incoming finger
   * path). Invalidates `debugBounds`, the next debug pass will recompute.
   */
  setPoint(i: number, x: number, y: number): void {
    if (i < 0 || i >= this.count)
      throw new RangeError(`Polyline index out of range: ${i}`)
    const base = i * 2
    this.data[base] = x
    this.data[base + 1] = y
    this.debugBounds = null
  }

  /** Copy a range of points as a new Float32Array (`[x0, y0, x1, y1, …]`). */
  slice(from = 0, to = this.count): Float32Array {
    if (from < 0 || to > this.count || from > to) {
      throw new RangeError('Polyline slice: bad range')
    }
    return this.data.slice(from * 2, to * 2)
  }

  /**
   * Ramer-Douglas-Peucker simplification. Reduces jitter without changing the
   * overall shape. Rarely needed at runtime; useful for saving a completed
   * drawing.
   */
  simplify(toleranceWorld: number): void {
    if (this.count < 3) return
    const kept = rdp(this.data, this.count, toleranceWorld)
    for (let i = 0; i < kept.length; i++) {
      const src = kept[i] * 2
      const dst = i * 2
      if (src !== dst) {
        this.data[dst] = this.data[src]
        this.data[dst + 1] = this.data[src + 1]
      }
    }
    this.count = kept.length
    this.debugBounds = null
    for (let i = 0; i < this.count; i++) {
      this.expandDebugBounds(this.data[i * 2], this.data[i * 2 + 1])
    }
  }

  override draw(gfx: Gfx2D, camera: Camera, _dt: number): void {
    if (this.count < 2) return
    const s = this.strokeSpace === 'world' ? 1 : camera.strokeSpaceScale()
    // Midpoint smoothing now lives in the gfx backend (Canvas2DGfx reproduces
    // the original quadratic construction exactly; the GPU backend flattens).
    gfx.strokePolyline(this.data, this.count, {
      color: this.strokeStyle,
      width: this.lineWidth * s,
      join: this.lineJoin,
      cap: this.lineCap,
      smoothing: this.smoothing,
    })
  }

  private grow(): void {
    const next = new Float32Array(this.data.length * 2)
    next.set(this.data)
    this.data = next
  }

  private expandDebugBounds(x: number, y: number): void {
    if (!this.debugBounds) {
      this.debugBounds = { x, y, width: 0, height: 0 }
      return
    }
    const b = this.debugBounds
    const right = Math.max(b.x + b.width, x)
    const bottom = Math.max(b.y + b.height, y)
    const left = Math.min(b.x, x)
    const top = Math.min(b.y, y)
    b.x = left
    b.y = top
    b.width = right - left
    b.height = bottom - top
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
