// Generates the outlines of Lottie shape items (path, rectangle, ellipse, star)
// as vertex-form paths: vertices with in and out tangents relative to each
// vertex. Modifiers (trim, round corners, ...) work on that form, and
// `appendPathData` writes it into a `GfxPath` at the end.

import type { GfxPath } from '../../render/gfx/GfxPath'
import type { PathData } from '../anim/props'
import type {
  LottieEllipseItem,
  LottiePathItem,
  LottieRectItem,
  LottieStarItem,
} from '../model/types'
import type { Affine } from './affine'

/** Control-point distance of a quarter circle drawn as one cubic. */
const KAPPA = 0.5522847498307936

const TMP2 = new Float64Array(2)

/** A pool of reusable {@link PathData} objects. `reset` recycles them all. */
export class PathPool {
  readonly #items: PathData[] = []
  #used = 0

  /** Recycle every path handed out so far. */
  reset(): void {
    this.#used = 0
  }

  /** A path with room for `count` vertices, `count` set and not closed. */
  acquire(count: number): PathData {
    let p = this.#items[this.#used]
    if (!p) {
      p = {
        count: 0,
        closed: false,
        v: new Float64Array(Math.max(count, 8) * 2),
        i: new Float64Array(Math.max(count, 8) * 2),
        o: new Float64Array(Math.max(count, 8) * 2),
      }
      this.#items[this.#used] = p
    } else if (p.v.length < count * 2) {
      const n = Math.max(count, p.v.length) * 2
      p.v = new Float64Array(n)
      p.i = new Float64Array(n)
      p.o = new Float64Array(n)
    }
    this.#used++
    p.count = count
    p.closed = false
    p.i.fill(0, 0, count * 2)
    p.o.fill(0, 0, count * 2)
    return p
  }
}

function set(
  p: PathData,
  k: number,
  x: number,
  y: number,
  ix = 0,
  iy = 0,
  ox = 0,
  oy = 0,
): void {
  p.v[k * 2] = x
  p.v[k * 2 + 1] = y
  p.i[k * 2] = ix
  p.i[k * 2 + 1] = iy
  p.o[k * 2] = ox
  p.o[k * 2 + 1] = oy
}

/**
 * Reverse a path in place, keeping its first vertex first. Each vertex swaps
 * its in and out tangents.
 */
export function reversePath(p: PathData): void {
  const n = p.count
  if (n < 2) return
  const { v, i, o } = p
  // Swap tangents on every vertex, then reverse the order of vertices 1..n-1.
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

/** Sample a bezier path item into a pooled path. */
export function genPath(
  pool: PathPool,
  item: LottiePathItem,
  frame: number,
): PathData {
  const p = pool.acquire(item.path.vertexCount)
  item.path.sample(frame, p)
  if (item.direction === 3) reversePath(p)
  return p
}

/**
 * A rectangle. It starts at the top right corner and runs clockwise, or the
 * other way for direction 3. A roundness above 0 rounds the corners, capped at
 * half the shorter side.
 */
export function genRect(
  pool: PathPool,
  item: LottieRectItem,
  frame: number,
): PathData {
  item.position.sample(frame, TMP2)
  const cx = TMP2[0]
  const cy = TMP2[1]
  item.size.sample(frame, TMP2)
  const hw = TMP2[0] / 2
  const hh = TMP2[1] / 2
  const r = Math.max(0, Math.min(item.roundness.get(frame), hw, hh))
  const l = cx - hw
  const rt = cx + hw
  const t = cy - hh
  const b = cy + hh
  let p: PathData
  if (r === 0) {
    p = pool.acquire(4)
    set(p, 0, rt, t)
    set(p, 1, rt, b)
    set(p, 2, l, b)
    set(p, 3, l, t)
  } else {
    const k = r * KAPPA
    p = pool.acquire(8)
    set(p, 0, rt, t + r, 0, -k)
    set(p, 1, rt, b - r, 0, 0, 0, k)
    set(p, 2, rt - r, b, k, 0)
    set(p, 3, l + r, b, 0, 0, -k, 0)
    set(p, 4, l, b - r, 0, k)
    set(p, 5, l, t + r, 0, 0, 0, -k)
    set(p, 6, l + r, t, -k, 0)
    set(p, 7, rt - r, t, 0, 0, k, 0)
  }
  p.closed = true
  if (item.direction === 3) reversePath(p)
  return p
}

/**
 * An ellipse. It starts at the top and runs clockwise, or the other way for
 * direction 3.
 */
export function genEllipse(
  pool: PathPool,
  item: LottieEllipseItem,
  frame: number,
): PathData {
  item.position.sample(frame, TMP2)
  const cx = TMP2[0]
  const cy = TMP2[1]
  item.size.sample(frame, TMP2)
  const rx = TMP2[0] / 2
  const ry = TMP2[1] / 2
  const kx = rx * KAPPA
  const ky = ry * KAPPA
  const p = pool.acquire(4)
  set(p, 0, cx, cy - ry, -kx, 0, kx, 0)
  set(p, 1, cx + rx, cy, 0, -ky, 0, ky)
  set(p, 2, cx, cy + ry, kx, 0, -kx, 0)
  set(p, 3, cx - rx, cy, 0, ky, 0, -ky)
  p.closed = true
  if (item.direction === 3) reversePath(p)
  return p
}

/**
 * A star or polygon. The first point sits straight up before rotation. A
 * fractional point count rounds down. Roundness is not applied. Returns `null`
 * when the point count is below 3.
 */
export function genStar(
  pool: PathPool,
  item: LottieStarItem,
  frame: number,
): PathData | null {
  item.position.sample(frame, TMP2)
  const cx = TMP2[0]
  const cy = TMP2[1]
  const count = Math.floor(item.points.get(frame))
  if (count < 3) return null
  const outer = item.outerRadius.get(frame)
  const inner = item.innerRadius ? item.innerRadius.get(frame) : outer
  const rot = ((item.rotation.get(frame) - 90) * Math.PI) / 180
  const isStar = item.starType === 1
  const total = isStar ? count * 2 : count
  const step = (Math.PI * 2) / total
  const dir = item.direction === 3 ? -1 : 1
  const p = pool.acquire(total)
  for (let k = 0; k < total; k++) {
    const radius = isStar && k % 2 === 1 ? inner : outer
    const a = rot + dir * k * step
    set(p, k, cx + radius * Math.cos(a), cy + radius * Math.sin(a))
  }
  p.closed = true
  return p
}

/** Apply `m` to a path in place. Tangents take the linear part only. */
export function transformPath(p: PathData, m: Affine): void {
  const a = m[0]
  const b = m[1]
  const c = m[2]
  const d = m[3]
  const e = m[4]
  const f = m[5]
  const n = p.count
  for (let k = 0; k < n; k++) {
    const x = p.v[k * 2]
    const y = p.v[k * 2 + 1]
    p.v[k * 2] = a * x + c * y + e
    p.v[k * 2 + 1] = b * x + d * y + f
    const ix = p.i[k * 2]
    const iy = p.i[k * 2 + 1]
    p.i[k * 2] = a * ix + c * iy
    p.i[k * 2 + 1] = b * ix + d * iy
    const ox = p.o[k * 2]
    const oy = p.o[k * 2 + 1]
    p.o[k * 2] = a * ox + c * oy
    p.o[k * 2 + 1] = b * ox + d * oy
  }
}

/** Append a vertex-form path to a `GfxPath`. */
export function appendPathData(target: GfxPath, d: PathData): void {
  const n = d.count
  if (n === 0) return
  const { v, i, o } = d
  target.moveTo(v[0], v[1])
  for (let k = 1; k < n; k++) {
    const p = k - 1
    target.cubicTo(
      v[p * 2] + o[p * 2],
      v[p * 2 + 1] + o[p * 2 + 1],
      v[k * 2] + i[k * 2],
      v[k * 2 + 1] + i[k * 2 + 1],
      v[k * 2],
      v[k * 2 + 1],
    )
  }
  if (d.closed) {
    const p = n - 1
    target.cubicTo(
      v[p * 2] + o[p * 2],
      v[p * 2 + 1] + o[p * 2 + 1],
      v[0] + i[0],
      v[1] + i[1],
      v[0],
      v[1],
    )
    target.close()
  }
}
