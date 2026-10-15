// Cuts polylines into dashes on the CPU, for dash patterns of any length and a
// start offset. Used by `Gfx2D.strokePath`. Lengths are in the polyline's own
// units, so a pattern in the current transform space needs no conversion.

/**
 * The dashes of one or more contours. The arrays are reused by the next call to
 * {@link DashBuffer.cut}.
 */
export class DashBuffer {
  /** Interleaved `x, y` points of every dash. */
  points = new Float32Array(256)
  /** First point index of each dash, plus a final entry equal to `pointCount`. */
  starts = new Uint32Array(32)
  /** Number of points written. */
  pointCount = 0
  /** Number of dashes written. */
  dashCount = 0

  /** Forget the dashes written so far. */
  clear(): void {
    this.pointCount = 0
    this.dashCount = 0
  }

  #reservePoints(extra: number): void {
    const need = (this.pointCount + extra) * 2
    if (need <= this.points.length) return
    const next = new Float32Array(Math.max(need, this.points.length * 2))
    next.set(this.points.subarray(0, this.pointCount * 2))
    this.points = next
  }

  #pushPoint(x: number, y: number): void {
    this.#reservePoints(1)
    const i = this.pointCount * 2
    this.points[i] = x
    this.points[i + 1] = y
    this.pointCount++
  }

  #beginDash(): void {
    if (this.dashCount + 2 > this.starts.length) {
      const next = new Uint32Array(this.starts.length * 2)
      next.set(this.starts)
      this.starts = next
    }
    this.starts[this.dashCount] = this.pointCount
  }

  #endDash(): void {
    this.dashCount++
    this.starts[this.dashCount] = this.pointCount
  }

  /**
   * Append the dashes of one contour. `pts` holds `count` points from `first`,
   * interleaved. `pattern` alternates dash and gap lengths, and an odd length
   * repeats itself to make an even one. `offset` shifts where the pattern
   * starts and may be negative. For a closed contour the dash that runs across
   * the closing point is joined into one.
   *
   * A pattern that sums to zero or less, or has a negative entry, leaves the
   * contour whole as a single dash.
   */
  cut(
    pts: Float32Array,
    first: number,
    count: number,
    closed: boolean,
    pattern: readonly number[],
    offset: number,
  ): void {
    const total = patternLength(pattern)
    if (count < 2 || total <= 0) {
      this.#copyWhole(pts, first, count, closed)
      return
    }
    const entries =
      pattern.length % 2 === 0 ? pattern.length : pattern.length * 2
    const at = (i: number): number => pattern[i % pattern.length]
    const period = pattern.length % 2 === 0 ? total : total * 2

    // Position in the pattern at the start of the contour.
    let phase = ((offset % period) + period) % period
    let idx = 0
    while (phase >= at(idx) && at(idx) >= 0) {
      phase -= at(idx)
      idx = (idx + 1) % entries
      // Zero-length entries at the start are skipped by the loop condition.
      if (phase === 0 && at(idx) > 0) break
    }
    let remaining = at(idx) - phase
    let on = idx % 2 === 0

    const segCount = closed ? count : count - 1
    const startDash = this.dashCount
    let firstDashOpen = false
    let open = false

    const x0 = pts[first * 2]
    const y0 = pts[first * 2 + 1]
    if (on) {
      this.#beginDash()
      this.#pushPoint(x0, y0)
      open = true
      firstDashOpen = true
    }
    let guard = 0
    for (let s = 0; s < segCount; s++) {
      const a = (first + s) * 2
      const b = (first + ((s + 1) % count)) * 2
      const ax = pts[a]
      const ay = pts[a + 1]
      const dx = pts[b] - ax
      const dy = pts[b + 1] - ay
      const segLen = Math.hypot(dx, dy)
      if (segLen === 0) continue
      let pos = 0
      while (segLen - pos > remaining) {
        pos += remaining
        const t = pos / segLen
        const px = ax + dx * t
        const py = ay + dy * t
        if (on) {
          this.#pushPoint(px, py)
          this.#endDash()
          open = false
        } else {
          this.#beginDash()
          this.#pushPoint(px, py)
          open = true
        }
        on = !on
        idx = (idx + 1) % entries
        remaining = at(idx)
        if (++guard > 1_000_000) return
      }
      remaining -= segLen - pos
      if (on) this.#pushPoint(pts[b], pts[b + 1])
    }
    if (open) this.#endDash()
    // The dash that ends on the closing point continues into the first one.
    if (closed && firstDashOpen && open && this.dashCount - startDash > 1) {
      this.#mergeSeam(startDash)
    }
  }

  /**
   * Join the first dash onto the end of the last dash, then drop the first
   * dash. The two meet at the contour's closing point.
   */
  #mergeSeam(startDash: number): void {
    const firstStart = this.starts[startDash]
    const firstEnd = this.starts[startDash + 1]
    const headLen = firstEnd - firstStart
    // Append the first dash's points, minus its repeated start point.
    this.#reservePoints(headLen)
    this.points.copyWithin(
      this.pointCount * 2,
      (firstStart + 1) * 2,
      firstEnd * 2,
    )
    this.pointCount += headLen - 1
    this.starts[this.dashCount] = this.pointCount
    // Remove the first dash and renumber the rest.
    this.points.copyWithin(firstStart * 2, firstEnd * 2, this.pointCount * 2)
    this.pointCount -= headLen
    for (let d = startDash + 1; d <= this.dashCount; d++) {
      this.starts[d - 1] = this.starts[d] - headLen
    }
    this.dashCount--
  }

  #copyWhole(
    pts: Float32Array,
    first: number,
    count: number,
    _closed: boolean,
  ): void {
    if (count < 2) return
    this.#beginDash()
    for (let i = 0; i < count; i++) {
      this.#pushPoint(pts[(first + i) * 2], pts[(first + i) * 2 + 1])
    }
    this.#endDash()
  }
}

function patternLength(pattern: readonly number[]): number {
  let sum = 0
  for (const v of pattern) {
    if (!(v >= 0)) return 0
    sum += v
  }
  return sum
}
