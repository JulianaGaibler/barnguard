// A mutable, reusable vector path for `Gfx2D.fillPath` and `strokePath`.

import { flattenCubic, flattenQuadratic } from '../../assets/SvgPathContours'

const VERB_MOVE = 0
const VERB_LINE = 1
const VERB_QUAD = 2
const VERB_CUBIC = 3
const VERB_CLOSE = 4

/** Floats of coordinates each verb consumes. */
const VERB_COORDS = [2, 2, 4, 6, 0]

/**
 * Points of headroom below which a flatten pass is retried in a larger buffer.
 * The flatteners stop silently at the end of their output array, so a buffer
 * that gets this close to full may have truncated a curve.
 */
const FLATTEN_HEADROOM = 4096

/**
 * The polylines a {@link GfxPath} flattens into at one tolerance. The arrays
 * belong to the path and are overwritten by its next flatten, so read them
 * before changing or re-flattening the path.
 */
export interface FlatPath {
  /** Interleaved `x, y` points of all contours. */
  readonly points: Float32Array
  /** Number of points (half the used length of `points`). */
  readonly pointCount: number
  /**
   * Index of each contour's first point, plus a final entry equal to
   * `pointCount`.
   */
  readonly starts: Uint32Array
  /** Number of contours. */
  readonly contourCount: number
  /** Per contour: `1` when the contour was closed with `close()`. */
  readonly closed: Uint8Array
  /** True when the path is one contour that turns the same way all around. */
  readonly convex: boolean
  /** Bounds of the flattened points. */
  readonly minX: number
  readonly minY: number
  readonly maxX: number
  readonly maxY: number
}

/**
 * A vector path built from move, line, quadratic and cubic segments. Unlike a
 * `Path2D` it can be cleared and refilled every frame without allocating, so it
 * suits shapes that change over time.
 *
 * Fill it with `moveTo`, `lineTo`, `quadTo`, `cubicTo` and `close`, then draw
 * it with `gfx.fillPath` or `gfx.strokePath`. Call `release()` when the path is
 * no longer needed.
 *
 * @remarks
 *   Engine developers: segments are stored as a verb array plus a coordinate
 *   array, both grown in place. `version` increments on every edit so a cache
 *   can tell when its data is stale. Flattening writes into buffers owned by
 *   the path and caches the result per (version, tolerance bucket), so drawing
 *   an unchanged path at a steady scale flattens once. The tolerance is rounded
 *   to a half power of two so a slow zoom does not re-flatten every frame.
 *
 *   A fill needs a stencil buffer to handle self-overlap, and winding is counted
 *   modulo 16, so 16 contours wound the same way over one point cancel out.
 * @example
 *   const star = new GfxPath()
 *   for (let i = 0; i < 5; i++) {
 *     const a = (i * 4 * Math.PI) / 5 - Math.PI / 2
 *     const x = 100 + 80 * Math.cos(a)
 *     const y = 100 + 80 * Math.sin(a)
 *     if (i === 0) star.moveTo(x, y)
 *     else star.lineTo(x, y)
 *   }
 *   star.close()
 *   gfx.fillPath(star, '#f5c542', 'evenodd')
 */
export class GfxPath {
  /** Increments on every edit. */
  version = 0

  #verbs = new Uint8Array(16)
  #verbCount = 0
  #coords = new Float32Array(64)
  #coordCount = 0
  #released = false

  /**
   * Flattened copies of the path, one per (version, tolerance bucket) drawn
   * lately. A path drawn at two scales in a frame flattens once for each.
   */
  #slots: FlatSlot[] = []
  #tick = 0

  /** Start a new contour at `(x, y)`. */
  moveTo(x: number, y: number): this {
    this.#push(VERB_MOVE, 2)
    this.#coords[this.#coordCount++] = x
    this.#coords[this.#coordCount++] = y
    return this
  }

  /** Add a straight segment to `(x, y)`. */
  lineTo(x: number, y: number): this {
    this.#push(VERB_LINE, 2)
    this.#coords[this.#coordCount++] = x
    this.#coords[this.#coordCount++] = y
    return this
  }

  /** Add a quadratic Bézier with control point `(cx, cy)` ending at `(x, y)`. */
  quadTo(cx: number, cy: number, x: number, y: number): this {
    this.#push(VERB_QUAD, 4)
    const c = this.#coords
    c[this.#coordCount++] = cx
    c[this.#coordCount++] = cy
    c[this.#coordCount++] = x
    c[this.#coordCount++] = y
    return this
  }

  /** Add a cubic Bézier through two control points ending at `(x, y)`. */
  cubicTo(
    c1x: number,
    c1y: number,
    c2x: number,
    c2y: number,
    x: number,
    y: number,
  ): this {
    this.#push(VERB_CUBIC, 6)
    const c = this.#coords
    c[this.#coordCount++] = c1x
    c[this.#coordCount++] = c1y
    c[this.#coordCount++] = c2x
    c[this.#coordCount++] = c2y
    c[this.#coordCount++] = x
    c[this.#coordCount++] = y
    return this
  }

  /** Close the current contour back to its first point. */
  close(): this {
    this.#push(VERB_CLOSE, 0)
    return this
  }

  /** Remove every segment. Keeps the allocated storage. */
  clear(): this {
    this.#verbCount = 0
    this.#coordCount = 0
    this.version++
    return this
  }

  /** True when the path has no segments. */
  get isEmpty(): boolean {
    return this.#verbCount === 0
  }

  /**
   * Release the path's storage. Drawing a released path draws nothing. Call it
   * when a node that owns the path is destroyed.
   */
  release(): void {
    this.#released = true
    this.#verbs = new Uint8Array(0)
    this.#coords = new Float32Array(0)
    this.#verbCount = 0
    this.#coordCount = 0
    this.#slots = []
    this.version++
  }

  /** True after {@link GfxPath.release}. */
  get released(): boolean {
    return this.#released
  }

  /**
   * Flatten into polylines with a curve error of at most `tolerance` (in the
   * path's own units). The result is cached for the path's current `version`
   * and the tolerance bucket, and stays valid until its entry is recycled by a
   * later flatten of the same path. Engine-internal, `Gfx2D` calls it.
   *
   * @internal
   */
  flatten(tolerance: number): FlatPath {
    const bucket = toleranceBucket(tolerance)
    const stamp = ++this.#tick
    let victim: FlatSlot | null = null
    let victimScore = Infinity
    for (const slot of this.#slots) {
      if (slot.version === this.version && slot.bucket === bucket) {
        slot.stamp = stamp
        return slot.flat
      }
      // A copy of an older version is never used again, so it goes first.
      const score = slot.version === this.version ? slot.stamp : -1
      if (score < victimScore) {
        victim = slot
        victimScore = score
      }
    }
    if (!victim || this.#slots.length < MAX_FLAT_SLOTS) {
      victim = newFlatSlot()
      this.#slots.push(victim)
    }
    const tol = Math.pow(2, -bucket / 2)
    this.#flattenInto(victim, tol)
    victim.version = this.version
    victim.bucket = bucket
    victim.stamp = stamp
    return victim.flat
  }

  #push(verb: number, coordCount: number): void {
    if (this.#released) return
    if (this.#verbCount === this.#verbs.length) {
      const next = new Uint8Array(this.#verbs.length * 2)
      next.set(this.#verbs)
      this.#verbs = next
    }
    if (this.#coordCount + coordCount > this.#coords.length) {
      const next = new Float32Array(
        Math.max(this.#coords.length * 2, this.#coordCount + coordCount),
      )
      next.set(this.#coords)
      this.#coords = next
    }
    this.#verbs[this.#verbCount++] = verb
    this.version++
  }

  #flattenInto(slot: FlatSlot, tol: number): void {
    for (;;) {
      if (this.#tryFlatten(slot, tol)) return
      slot.pts = new Float32Array(slot.pts.length * 2)
    }
  }

  /** One flatten pass. False when the point buffer was too small. */
  #tryFlatten(slot: FlatSlot, tol: number): boolean {
    const verbs = this.#verbs
    const coords = this.#coords
    const pts = slot.pts
    let cursor = 0
    let ci = 0
    let contours = 0
    let startX = 0
    let startY = 0
    let curX = 0
    let curY = 0
    let open = false
    let starts = slot.starts
    let closed = slot.closed

    const beginContour = (x: number, y: number): void => {
      if (contours + 2 > starts.length) {
        const ns = new Uint32Array(starts.length * 2)
        ns.set(starts)
        starts = ns
        const nc = new Uint8Array(starts.length)
        nc.set(closed)
        closed = nc
      }
      starts[contours] = cursor / 2
      closed[contours] = 0
      contours++
      pts[cursor++] = x
      pts[cursor++] = y
      startX = curX = x
      startY = curY = y
      open = true
    }

    for (let v = 0; v < this.#verbCount; v++) {
      if (cursor + FLATTEN_HEADROOM > pts.length) return false
      const verb = verbs[v]
      switch (verb) {
        case VERB_MOVE:
          beginContour(coords[ci], coords[ci + 1])
          break
        case VERB_LINE:
          if (!open) beginContour(curX, curY)
          curX = coords[ci]
          curY = coords[ci + 1]
          pts[cursor++] = curX
          pts[cursor++] = curY
          break
        case VERB_QUAD:
          if (!open) beginContour(curX, curY)
          cursor = flattenQuadratic(
            curX,
            curY,
            coords[ci],
            coords[ci + 1],
            coords[ci + 2],
            coords[ci + 3],
            tol,
            pts,
            cursor,
          )
          curX = coords[ci + 2]
          curY = coords[ci + 3]
          break
        case VERB_CUBIC:
          if (!open) beginContour(curX, curY)
          cursor = flattenCubic(
            curX,
            curY,
            coords[ci],
            coords[ci + 1],
            coords[ci + 2],
            coords[ci + 3],
            coords[ci + 4],
            coords[ci + 5],
            tol,
            pts,
            cursor,
          )
          curX = coords[ci + 4]
          curY = coords[ci + 5]
          break
        case VERB_CLOSE:
          if (open) {
            closed[contours - 1] = 1
            curX = startX
            curY = startY
            open = false
          }
          break
      }
      ci += VERB_COORDS[verb]
    }
    if (cursor + FLATTEN_HEADROOM > pts.length) return false

    slot.starts = starts
    slot.closed = closed
    starts[contours] = cursor / 2
    cursor = compactContours(pts, starts, closed, contours) * 2
    const flat = slot.flat
    flat.points = pts
    flat.pointCount = cursor / 2
    flat.starts = starts
    flat.contourCount = contours
    flat.closed = closed
    this.#measure(flat)
    return true
  }

  #measure(flat: MutableFlat): void {
    const pts = flat.points
    const n = flat.pointCount
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (let i = 0; i < n; i++) {
      const x = pts[i * 2]
      const y = pts[i * 2 + 1]
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
    flat.minX = n > 0 ? minX : 0
    flat.minY = n > 0 ? minY : 0
    flat.maxX = n > 0 ? maxX : 0
    flat.maxY = n > 0 ? maxY : 0
    flat.convex = flat.contourCount === 1 && isConvex(pts, n)
  }
}

/**
 * Remove repeated points within each contour, and the last point of a closed
 * contour when it repeats the first. Artwork often writes the start point
 * twice, and a zero-length edge breaks the stroke tessellation. Rewrites
 * `starts` and returns the new point count.
 */
function compactContours(
  pts: Float32Array,
  starts: Uint32Array,
  closed: Uint8Array,
  contours: number,
): number {
  let w = 0
  for (let c = 0; c < contours; c++) {
    const begin = starts[c]
    const end = starts[c + 1]
    starts[c] = w
    const first = w
    for (let i = begin; i < end; i++) {
      const x = pts[i * 2]
      const y = pts[i * 2 + 1]
      if (w > first && pts[(w - 1) * 2] === x && pts[(w - 1) * 2 + 1] === y) {
        continue
      }
      pts[w * 2] = x
      pts[w * 2 + 1] = y
      w++
    }
    if (
      closed[c] === 1 &&
      w - first > 1 &&
      pts[(w - 1) * 2] === pts[first * 2] &&
      pts[(w - 1) * 2 + 1] === pts[first * 2 + 1]
    ) {
      w--
    }
  }
  starts[contours] = w
  return w
}

/** The most flattened copies one path keeps. */
const MAX_FLAT_SLOTS = 4

interface FlatSlot {
  pts: Float32Array
  starts: Uint32Array
  closed: Uint8Array
  flat: MutableFlat
  version: number
  bucket: number
  stamp: number
}

function newFlatSlot(): FlatSlot {
  const pts = new Float32Array(128)
  const starts = new Uint32Array(8)
  const closed = new Uint8Array(8)
  return {
    pts,
    starts,
    closed,
    flat: {
      points: pts,
      pointCount: 0,
      starts,
      contourCount: 0,
      closed,
      convex: false,
      minX: 0,
      minY: 0,
      maxX: 0,
      maxY: 0,
    },
    version: -1,
    bucket: -1,
    stamp: 0,
  }
}

interface MutableFlat {
  points: Float32Array
  pointCount: number
  starts: Uint32Array
  contourCount: number
  closed: Uint8Array
  convex: boolean
  minX: number
  minY: number
  maxX: number
  maxY: number
}

/**
 * Whether the closed polygon turns the same way at every vertex and winds once.
 * A pentagram turns the same way throughout but winds twice, which the total
 * turning angle catches.
 */
function isConvex(pts: Float32Array, n: number): boolean {
  if (n < 3) return false
  let sign = 0
  let total = 0
  for (let i = 0; i < n; i++) {
    const a = i * 2
    const b = ((i + 1) % n) * 2
    const c = ((i + 2) % n) * 2
    const e1x = pts[b] - pts[a]
    const e1y = pts[b + 1] - pts[a + 1]
    const e2x = pts[c] - pts[b]
    const e2y = pts[c + 1] - pts[b + 1]
    const cross = e1x * e2y - e1y * e2x
    const dot = e1x * e2x + e1y * e2y
    if (Math.abs(cross) < 1e-9) {
      if (dot < 0) return false
      continue
    }
    const s = cross > 0 ? 1 : -1
    if (sign === 0) sign = s
    else if (s !== sign) return false
    total += Math.atan2(cross, dot)
  }
  return sign !== 0 && Math.abs(Math.abs(total) - 2 * Math.PI) < 1e-3
}

/**
 * Half-power-of-two bucket of a tolerance, so tiny scale changes share a
 * flatten.
 */
function toleranceBucket(tol: number): number {
  return Math.round(-2 * Math.log2(Math.max(tol, 1e-6)))
}
