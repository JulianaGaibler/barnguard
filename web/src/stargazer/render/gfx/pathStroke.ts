// Turns a polyline into the filled region of its stroke, as a set of convex
// pieces appended to a `GfxPath`: one quad per segment, a join piece at every
// bend and a piece for each cap. Every piece is wound the same way, so filling
// the result with the nonzero rule paints their union exactly once, whatever
// the bends do to each other. That makes it safe where an outline traced around
// the stroke would fold over itself, for example at a tight bend of a wide line.
//
// Pieces overlap along the stroke, so the result needs a nonzero fill. Filling
// it even-odd leaves holes where two pieces meet.

import type { GfxPath } from './GfxPath'

/** Line cap, as in Canvas. */
type Cap = 'butt' | 'round' | 'square'
/** Line join, as in Canvas. */
type Join = 'miter' | 'round' | 'bevel'

const TMP: number[] = []

/** Append `pts` (interleaved x, y) as a closed polygon, wound positively. */
function emit(out: GfxPath, pts: number[]): void {
  const n = pts.length / 2
  if (n < 3) return
  let area = 0
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    area += pts[i * 2] * pts[j * 2 + 1] - pts[j * 2] * pts[i * 2 + 1]
  }
  if (area === 0) return
  if (area > 0) {
    out.moveTo(pts[0], pts[1])
    for (let i = 1; i < n; i++) out.lineTo(pts[i * 2], pts[i * 2 + 1])
  } else {
    out.moveTo(pts[(n - 1) * 2], pts[(n - 1) * 2 + 1])
    for (let i = n - 2; i >= 0; i--) out.lineTo(pts[i * 2], pts[i * 2 + 1])
  }
  out.close()
}

/** Steps for a full circle of radius `r` so the chord error stays under `tol`. */
function circleSteps(r: number, tol: number): number {
  if (r <= tol) return 8
  const steps = Math.ceil(Math.PI / Math.acos(1 - tol / r))
  return Math.max(8, Math.min(96, steps))
}

/** A disc around `(x, y)`. */
function disc(
  out: GfxPath,
  x: number,
  y: number,
  r: number,
  tol: number,
): void {
  const steps = circleSteps(r, tol)
  TMP.length = 0
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * Math.PI * 2
    TMP.push(x + Math.cos(a) * r, y + Math.sin(a) * r)
  }
  emit(out, TMP)
}

/**
 * Append the stroke of one polyline to `out`. `count` points start at point
 * `first` of `pts`. `tolerance` is the largest chord error of a round join or
 * cap, in the polyline's units. Repeated points are skipped, and a polyline
 * with fewer than two distinct points draws only its round or square dot.
 */
export function appendStrokeFill(
  out: GfxPath,
  pts: ArrayLike<number>,
  first: number,
  count: number,
  closed: boolean,
  width: number,
  cap: Cap,
  join: Join,
  miterLimit: number,
  tolerance: number,
): void {
  if (width <= 0 || count < 1) return
  const hw = width / 2
  // Distinct points only.
  const xs: number[] = []
  const ys: number[] = []
  for (let i = 0; i < count; i++) {
    const x = pts[(first + i) * 2]
    const y = pts[(first + i) * 2 + 1]
    if (xs.length > 0 && xs[xs.length - 1] === x && ys[ys.length - 1] === y) {
      continue
    }
    xs.push(x)
    ys.push(y)
  }
  if (
    closed &&
    xs.length > 1 &&
    xs[0] === xs[xs.length - 1] &&
    ys[0] === ys[ys.length - 1]
  ) {
    xs.pop()
    ys.pop()
  }
  const n = xs.length
  if (n === 1) {
    if (cap === 'round') disc(out, xs[0], ys[0], hw, tolerance)
    else if (cap === 'square') {
      emit(out, [
        xs[0] - hw,
        ys[0] - hw,
        xs[0] + hw,
        ys[0] - hw,
        xs[0] + hw,
        ys[0] + hw,
        xs[0] - hw,
        ys[0] + hw,
      ])
    }
    return
  }
  if (n < 2) return
  const segs = closed ? n : n - 1
  // Unit direction of each segment.
  const dx: number[] = []
  const dy: number[] = []
  for (let i = 0; i < segs; i++) {
    const j = (i + 1) % n
    const vx = xs[j] - xs[i]
    const vy = ys[j] - ys[i]
    const len = Math.hypot(vx, vy)
    dx.push(vx / len)
    dy.push(vy / len)
  }
  for (let i = 0; i < segs; i++) {
    const j = (i + 1) % n
    const nx = -dy[i] * hw
    const ny = dx[i] * hw
    emit(out, [
      xs[i] + nx,
      ys[i] + ny,
      xs[j] + nx,
      ys[j] + ny,
      xs[j] - nx,
      ys[j] - ny,
      xs[i] - nx,
      ys[i] - ny,
    ])
  }
  // Joins at every vertex that has a segment on both sides.
  const firstJoin = closed ? 0 : 1
  const lastJoin = closed ? n - 1 : n - 2
  for (let v = firstJoin; v <= lastJoin; v++) {
    const a = (v - 1 + segs) % segs
    const b = v % segs
    const cross = dx[a] * dy[b] - dy[a] * dx[b]
    const dot = dx[a] * dx[b] + dy[a] * dy[b]
    if (Math.abs(cross) < 1e-9 && dot > 0) continue
    if (join === 'round') {
      disc(out, xs[v], ys[v], hw, tolerance)
      continue
    }
    // The outer side of the bend is opposite the turn.
    const s = cross > 0 ? -1 : 1
    const o1x = -dy[a] * hw * s
    const o1y = dx[a] * hw * s
    const o2x = -dy[b] * hw * s
    const o2y = dx[b] * hw * s
    const px = xs[v]
    const py = ys[v]
    TMP.length = 0
    TMP.push(px, py, px + o1x, py + o1y)
    if (join === 'miter') {
      const ratio = Math.sqrt(2 / (1 + dot))
      if (1 + dot > 1e-9 && ratio <= miterLimit) {
        const k = 1 / (1 + dot)
        TMP.push(px + (o1x + o2x) * k, py + (o1y + o2y) * k)
      }
    }
    TMP.push(px + o2x, py + o2y)
    emit(out, TMP)
  }
  if (closed || cap === 'butt') return
  // Caps at the two ends.
  for (const end of [0, 1]) {
    const v = end === 0 ? 0 : n - 1
    const sx = end === 0 ? -dx[0] : dx[segs - 1]
    const sy = end === 0 ? -dy[0] : dy[segs - 1]
    const px = xs[v]
    const py = ys[v]
    const nx = -sy * hw
    const ny = sx * hw
    if (cap === 'square') {
      emit(out, [
        px + nx,
        py + ny,
        px + nx + sx * hw,
        py + ny + sy * hw,
        px - nx + sx * hw,
        py - ny + sy * hw,
        px - nx,
        py - ny,
      ])
    } else {
      disc(out, px, py, hw, tolerance)
    }
  }
}
