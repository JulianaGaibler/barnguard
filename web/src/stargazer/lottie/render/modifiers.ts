// Shape modifiers over vertex-form paths: trim, round corners, pucker and
// bloat. Each takes the current set of paths and writes the modified set, with
// new paths drawn from a pool so nothing allocates once the pools are warm.

import type { PathData } from '../anim/props'
import { PathPool } from './shapes'

/** Samples per cubic when measuring arc length. */
const LEN_STEPS = 16
const KAPPA = 0.5522847498307936

const PT = new Float64Array(2)

/** A growable list of paths. */
export class PathSet {
  items: PathData[] = []
  count = 0
  /**
   * The fill rule the set must be drawn with, set by a merge. `null` leaves the
   * choice to the fill.
   */
  rule: 'nonzero' | 'evenodd' | null = null
  /** True once a union or exclusion has treated the paths as one shape. */
  merged = false

  clear(): void {
    this.count = 0
    this.rule = null
    this.merged = false
  }

  push(p: PathData): void {
    this.items[this.count++] = p
  }
}

function cubicPoint(
  p0x: number,
  p0y: number,
  p1x: number,
  p1y: number,
  p2x: number,
  p2y: number,
  p3x: number,
  p3y: number,
  t: number,
  out: Float64Array,
): void {
  const mt = 1 - t
  const a = mt * mt * mt
  const b = 3 * mt * mt * t
  const c = 3 * mt * t * t
  const d = t * t * t
  out[0] = a * p0x + b * p1x + c * p2x + d * p3x
  out[1] = a * p0y + b * p1y + c * p2y + d * p3y
}

/**
 * Segment `k` of `p` is from vertex `k` to vertex `k + 1` (wrapping when
 * closed).
 */
function segmentCount(p: PathData): number {
  return p.closed ? p.count : p.count - 1
}

function segPoints(p: PathData, k: number, out: Float64Array): void {
  const a = k * 2
  const bi = ((k + 1) % p.count) * 2
  out[0] = p.v[a]
  out[1] = p.v[a + 1]
  out[2] = p.v[a] + p.o[a]
  out[3] = p.v[a + 1] + p.o[a + 1]
  out[4] = p.v[bi] + p.i[bi]
  out[5] = p.v[bi + 1] + p.i[bi + 1]
  out[6] = p.v[bi]
  out[7] = p.v[bi + 1]
}

const SEG = new Float64Array(8)

/** Length of one segment, by sampling. */
function segLength(p: PathData, k: number): number {
  segPoints(p, k, SEG)
  let len = 0
  let px = SEG[0]
  let py = SEG[1]
  for (let s = 1; s <= LEN_STEPS; s++) {
    cubicPoint(
      SEG[0],
      SEG[1],
      SEG[2],
      SEG[3],
      SEG[4],
      SEG[5],
      SEG[6],
      SEG[7],
      s / LEN_STEPS,
      PT,
    )
    len += Math.hypot(PT[0] - px, PT[1] - py)
    px = PT[0]
    py = PT[1]
  }
  return len
}

/** The `t` on segment `k` where the arc length from its start is `target`. */
function tAtLength(
  p: PathData,
  k: number,
  target: number,
  total: number,
): number {
  if (total <= 0) return 0
  segPoints(p, k, SEG)
  let len = 0
  let px = SEG[0]
  let py = SEG[1]
  for (let s = 1; s <= LEN_STEPS; s++) {
    cubicPoint(
      SEG[0],
      SEG[1],
      SEG[2],
      SEG[3],
      SEG[4],
      SEG[5],
      SEG[6],
      SEG[7],
      s / LEN_STEPS,
      PT,
    )
    const d = Math.hypot(PT[0] - px, PT[1] - py)
    if (len + d >= target) {
      const f = d > 0 ? (target - len) / d : 0
      return (s - 1 + f) / LEN_STEPS
    }
    len += d
    px = PT[0]
    py = PT[1]
  }
  return 1
}

/**
 * The sub-cubic of `[p0 p1 p2 p3]` between parameters `t0` and `t1`, into
 * `out[8]`.
 */
function subCubic(
  src: Float64Array,
  t0: number,
  t1: number,
  out: Float64Array,
): void {
  // Split at t1 first, keeping the left part, then split that at t0 / t1.
  const l = SUBL
  splitLeft(src, t1, l)
  if (t0 <= 0 || t1 <= 0) {
    out.set(l)
    return
  }
  const u = t0 / t1
  splitRight(l, u, out)
}

function lerp2(
  a: Float64Array,
  ai: number,
  b: Float64Array,
  bi: number,
  t: number,
  out: Float64Array,
  oi: number,
): void {
  out[oi] = a[ai] + (b[bi] - a[ai]) * t
  out[oi + 1] = a[ai + 1] + (b[bi + 1] - a[ai + 1]) * t
}

const Q = new Float64Array(12)
const SUBL = new Float64Array(8)

/** Left part `[0, t]` of a cubic. */
function splitLeft(c: Float64Array, t: number, out: Float64Array): void {
  lerp2(c, 0, c, 2, t, Q, 0) // p01
  lerp2(c, 2, c, 4, t, Q, 2) // p12
  lerp2(c, 4, c, 6, t, Q, 4) // p23
  lerp2(Q, 0, Q, 2, t, Q, 6) // p012
  lerp2(Q, 2, Q, 4, t, Q, 8) // p123
  const mx = Q[6] + (Q[8] - Q[6]) * t
  const my = Q[7] + (Q[9] - Q[7]) * t
  out[0] = c[0]
  out[1] = c[1]
  out[2] = Q[0]
  out[3] = Q[1]
  out[4] = Q[6]
  out[5] = Q[7]
  out[6] = mx
  out[7] = my
}

/** Right part `[t, 1]` of a cubic. */
function splitRight(c: Float64Array, t: number, out: Float64Array): void {
  lerp2(c, 0, c, 2, t, Q, 0)
  lerp2(c, 2, c, 4, t, Q, 2)
  lerp2(c, 4, c, 6, t, Q, 4)
  lerp2(Q, 0, Q, 2, t, Q, 6)
  lerp2(Q, 2, Q, 4, t, Q, 8)
  const mx = Q[6] + (Q[8] - Q[6]) * t
  const my = Q[7] + (Q[9] - Q[7]) * t
  out[0] = mx
  out[1] = my
  out[2] = Q[8]
  out[3] = Q[9]
  out[4] = Q[4]
  out[5] = Q[5]
  out[6] = c[6]
  out[7] = c[7]
}

const SEG_LEN: number[] = []
const PIECE = new Float64Array(8)

/**
 * The part of `p` between arc lengths `d0` and `d1` as a new open path, or
 * `null` when it is empty. `segLens` holds each segment's length.
 */
function extract(
  pool: PathPool,
  p: PathData,
  segLens: readonly number[],
  d0: number,
  d1: number,
): PathData | null {
  const nSeg = segmentCount(p)
  const out = pool.acquire(nSeg + 2)
  let count = 0
  let pos = 0
  for (let k = 0; k < nSeg; k++) {
    const len = segLens[k]
    const a = pos
    const b = pos + len
    pos = b
    if (b <= d0 || a >= d1 || len <= 0) continue
    const t0 = d0 > a ? tAtLength(p, k, d0 - a, len) : 0
    const t1 = d1 < b ? tAtLength(p, k, d1 - a, len) : 1
    if (t1 <= t0) continue
    segPoints(p, k, SEG)
    subCubic(SEG, t0, t1, PIECE)
    if (count === 0) {
      out.v[0] = PIECE[0]
      out.v[1] = PIECE[1]
      out.i[0] = 0
      out.i[1] = 0
      count = 1
    }
    const last = count - 1
    out.o[last * 2] = PIECE[2] - PIECE[0]
    out.o[last * 2 + 1] = PIECE[3] - PIECE[1]
    out.v[count * 2] = PIECE[6]
    out.v[count * 2 + 1] = PIECE[7]
    out.i[count * 2] = PIECE[4] - PIECE[6]
    out.i[count * 2 + 1] = PIECE[5] - PIECE[7]
    out.o[count * 2] = 0
    out.o[count * 2 + 1] = 0
    count++
  }
  if (count < 2) return null
  out.count = count
  out.closed = false
  return out
}

/** Ranges of `[0, 1]` a trim keeps, written to `out` as `lo, hi` pairs. */
function trimRanges(
  start: number,
  end: number,
  offset: number,
  out: number[],
): void {
  out.length = 0
  let s = Math.max(0, Math.min(1, start))
  let e = Math.max(0, Math.min(1, end))
  if (s > e) {
    const t = s
    s = e
    e = t
  }
  const span = e - s
  if (span <= 0) return
  if (span >= 1) {
    out.push(0, 1)
    return
  }
  let a = s + offset
  a -= Math.floor(a)
  const b = a + span
  if (b <= 1) {
    out.push(a, b)
  } else {
    out.push(a, 1, 0, b - 1)
  }
}

const RANGES: number[] = []

/**
 * Keep the part of every path between `start` and `end` (fractions of the
 * length), shifted by `offset` (a fraction of a full turn). `individual` trims
 * each path on its own length, otherwise the paths are measured as one
 * concatenated length.
 */
export function trimSet(
  set: PathSet,
  out: PathSet,
  pool: PathPool,
  start: number,
  end: number,
  offset: number,
  individual: boolean,
): void {
  out.clear()
  trimRanges(start, end, offset, RANGES)
  if (RANGES.length === 0) return
  const lens: number[][] = []
  let total = 0
  const pathLen: number[] = []
  for (let i = 0; i < set.count; i++) {
    const p = set.items[i]
    const segs: number[] = []
    let sum = 0
    for (let k = 0; k < segmentCount(p); k++) {
      const l = segLength(p, k)
      segs.push(l)
      sum += l
    }
    lens.push(segs)
    pathLen.push(sum)
    total += sum
  }
  let base = 0
  for (let i = 0; i < set.count; i++) {
    const p = set.items[i]
    const len = pathLen[i]
    const scale = individual ? len : total
    const shift = individual ? 0 : base
    for (let r = 0; r < RANGES.length; r += 2) {
      let d0 = RANGES[r] * scale - shift
      let d1 = RANGES[r + 1] * scale - shift
      if (d1 <= 0 || d0 >= len) continue
      d0 = Math.max(0, d0)
      d1 = Math.min(len, d1)
      // A closed path trimmed to all but a hair stays closed. Stroking an open
      // path whose ends nearly meet tessellates badly, and the gap is invisible.
      const slack = Math.max(len * 0.002, 1e-4)
      if (p.closed && d0 <= slack && d1 >= len - slack) {
        out.push(p)
        continue
      }
      SEG_LEN.length = 0
      for (const l of lens[i]) SEG_LEN.push(l)
      const piece = extract(pool, p, SEG_LEN, d0, d1)
      if (piece) out.push(piece)
    }
    base += len
  }
}

/**
 * Round the corners where two straight edges meet. A corner's radius shrinks to
 * fit half of the shorter adjacent edge. Vertices with curved neighbours are
 * left alone.
 */
export function roundCornersSet(
  set: PathSet,
  out: PathSet,
  pool: PathPool,
  radius: number,
): void {
  out.clear()
  if (radius <= 0) {
    for (let i = 0; i < set.count; i++) out.push(set.items[i])
    return
  }
  for (let i = 0; i < set.count; i++) {
    const p = set.items[i]
    const n = p.count
    if (n < 3) {
      out.push(p)
      continue
    }
    const q = pool.acquire(n * 2)
    let c = 0
    for (let k = 0; k < n; k++) {
      const prev = (k + n - 1) % n
      const next = (k + 1) % n
      const x = p.v[k * 2]
      const y = p.v[k * 2 + 1]
      const endpoint = !p.closed && (k === 0 || k === n - 1)
      const corner =
        !endpoint &&
        p.i[k * 2] === 0 &&
        p.i[k * 2 + 1] === 0 &&
        p.o[k * 2] === 0 &&
        p.o[k * 2 + 1] === 0 &&
        p.o[prev * 2] === 0 &&
        p.o[prev * 2 + 1] === 0 &&
        p.i[next * 2] === 0 &&
        p.i[next * 2 + 1] === 0
      if (!corner) {
        q.v[c * 2] = x
        q.v[c * 2 + 1] = y
        q.i[c * 2] = p.i[k * 2]
        q.i[c * 2 + 1] = p.i[k * 2 + 1]
        q.o[c * 2] = p.o[k * 2]
        q.o[c * 2 + 1] = p.o[k * 2 + 1]
        c++
        continue
      }
      const ax = p.v[prev * 2] - x
      const ay = p.v[prev * 2 + 1] - y
      const bx = p.v[next * 2] - x
      const by = p.v[next * 2 + 1] - y
      const la = Math.hypot(ax, ay)
      const lb = Math.hypot(bx, by)
      const d = Math.min(radius, la / 2, lb / 2)
      if (d <= 0 || la === 0 || lb === 0) {
        q.v[c * 2] = x
        q.v[c * 2 + 1] = y
        c++
        continue
      }
      const sax = x + (ax / la) * d
      const say = y + (ay / la) * d
      const sbx = x + (bx / lb) * d
      const sby = y + (by / lb) * d
      const f = 1 - KAPPA
      // Arrive at the first point on the incoming edge, curve to the second.
      q.v[c * 2] = sax
      q.v[c * 2 + 1] = say
      q.i[c * 2] = 0
      q.i[c * 2 + 1] = 0
      q.o[c * 2] = (x - sax) * (1 - f)
      q.o[c * 2 + 1] = (y - say) * (1 - f)
      c++
      q.v[c * 2] = sbx
      q.v[c * 2 + 1] = sby
      q.i[c * 2] = (x - sbx) * (1 - f)
      q.i[c * 2 + 1] = (y - sby) * (1 - f)
      q.o[c * 2] = 0
      q.o[c * 2 + 1] = 0
      c++
    }
    q.count = c
    q.closed = p.closed
    out.push(q)
  }
}

/**
 * Pull vertices toward the mean of the path's vertices (pucker, positive
 * `amount`) or push them away (bloat, negative), with tangent handles moving
 * the opposite way.
 */
export function puckerBloatSet(
  set: PathSet,
  out: PathSet,
  pool: PathPool,
  amount: number,
): void {
  out.clear()
  for (let i = 0; i < set.count; i++) {
    const p = set.items[i]
    const n = p.count
    if (n === 0) continue
    let cx = 0
    let cy = 0
    for (let k = 0; k < n; k++) {
      cx += p.v[k * 2]
      cy += p.v[k * 2 + 1]
    }
    cx /= n
    cy /= n
    const q = pool.acquire(n)
    for (let k = 0; k < n; k++) {
      const x = p.v[k * 2]
      const y = p.v[k * 2 + 1]
      const vx = x + (cx - x) * amount
      const vy = y + (cy - y) * amount
      const ox = x + p.o[k * 2]
      const oy = y + p.o[k * 2 + 1]
      const ix = x + p.i[k * 2]
      const iy = y + p.i[k * 2 + 1]
      const nox = ox + (cx - ox) * -amount
      const noy = oy + (cy - oy) * -amount
      const nix = ix + (cx - ix) * -amount
      const niy = iy + (cy - iy) * -amount
      q.v[k * 2] = vx
      q.v[k * 2 + 1] = vy
      q.o[k * 2] = nox - vx
      q.o[k * 2 + 1] = noy - vy
      q.i[k * 2] = nix - vx
      q.i[k * 2 + 1] = niy - vy
    }
    q.count = n
    q.closed = p.closed
    out.push(q)
  }
}

/**
 * Twice the signed area of a path's vertex polygon. Positive is clockwise on
 * screen.
 */
function signedArea(p: PathData): number {
  let a = 0
  const n = p.count
  for (let k = 0; k < n; k++) {
    const j = (k + 1) % n
    a += p.v[k * 2] * p.v[j * 2 + 1] - p.v[j * 2] * p.v[k * 2 + 1]
  }
  return a
}

/**
 * Combine the paths with a merge mode. Union (merge, add) turns every closed
 * path the same way and asks for a nonzero fill, so overlaps fill once. Exclude
 * intersections asks for an even-odd fill. Subtract and intersect need a
 * boolean operation on the outlines. They do nothing when there is only one
 * shape to combine, and report `false` when they cannot be applied.
 */
export function mergeSet(set: PathSet, mode: number): boolean {
  if (mode === 3 || mode === 4) return set.count < 2 || set.merged
  set.merged = true
  if (mode === 1 || mode === 2) {
    for (let i = 0; i < set.count; i++) {
      const p = set.items[i]
      if (p.closed && signedArea(p) < 0) reverseInPlace(p)
    }
    set.rule = 'nonzero'
  } else if (mode === 5) {
    set.rule = 'evenodd'
  }
  return true
}

function reverseInPlace(p: PathData): void {
  const n = p.count
  if (n < 2) return
  const { v, i, o } = p
  for (let k = 0; k < n * 2; k++) {
    const t = i[k]
    i[k] = o[k]
    o[k] = t
  }
  for (let a = 1, b = n - 1; a < b; a++, b--) {
    for (let c = 0; c < 2; c++) {
      let t = v[a * 2 + c]
      v[a * 2 + c] = v[b * 2 + c]
      v[b * 2 + c] = t
      t = i[a * 2 + c]
      i[a * 2 + c] = i[b * 2 + c]
      i[b * 2 + c] = t
      t = o[a * 2 + c]
      o[a * 2 + c] = o[b * 2 + c]
      o[b * 2 + c] = t
    }
  }
}
