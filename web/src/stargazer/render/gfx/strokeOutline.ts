/**
 * Tessellate a polyline's stroke into a filled, antialiased outline: exact
 * joins and caps, any alignment, no overlapping geometry in the ordinary case.
 * A stroke that is a fill composes with any paint (a flat color or a gradient)
 * for free, which the segment stroker (`programs/stroke.ts`) cannot do, since
 * it has no paint slot.
 *
 * Construction: build one (open contour) or two (closed contour: outer edge
 * plus the hole its inner edge cuts) simple boundary loops by offsetting the
 * input polyline with real joins, triangulate them with `earcut` (the same
 * library `fillPolyLinearGradient` already uses), then ring a one-vertex-wide
 * fringe of antialiasing around every loop, coverage 1 at the core edge ramping
 * to 0 outside it. No device, no allocation beyond the scratch buffers below,
 * so this runs equally well on or off the render thread.
 *
 * Degenerate geometry (a short segment or an acute inner corner forcing the
 * offset boundary to fold over itself) is not specially detected. `earcut`
 * still returns a triangulation, it is just one with visible overlap at that
 * corner. See the stroke-outline guide section for the accepted limitation and
 * the recorded coverage-pass follow-up.
 */

import earcut from 'earcut'

/** Border position relative to the source path. */
export type StrokeAlign = 'center' | 'inside' | 'outside'

/** Pixel tolerance for adaptive arc flattening (round joins/caps). */
export const ARC_TOL_PX = 0.25
/** Angular step clamp for arc flattening, radians. */
export const ARC_STEP_MIN = (3 * Math.PI) / 180
export const ARC_STEP_MAX = (90 * Math.PI) / 180
/** SVG `stroke-miterlimit` default. `CanvasRenderingContext2D` defaults to 10. */
export const DEFAULT_MITER_LIMIT = 4
/** AA ramp width in device px, resolved per vertex against the local scale. */
export const FRINGE_PX = 1.0
/**
 * Half-octave cache-key bucketing for a device scale: a bin spans a factor of
 * `2**(1/SCALE_KEY_OCTAVE_STEPS)`. Tessellating at the bin's geometric center
 * (not the scale that first missed) bounds the in-bin error to
 * `2**(0.5/SCALE_KEY_OCTAVE_STEPS)`, about 1.19x at the default of 2.
 */
export const SCALE_KEY_OCTAVE_STEPS = 2

/** The half-octave bucket index for `scale` (device px per local unit). */
export function scaleBucketIndex(scale: number): number {
  return Math.round(Math.log2(Math.max(scale, 1e-6)) * SCALE_KEY_OCTAVE_STEPS)
}

/**
 * The geometric-center scale of bucket `index`, for tessellating a cached
 * variant.
 */
export function scaleBucketCenter(index: number): number {
  return 2 ** (index / SCALE_KEY_OCTAVE_STEPS)
}

const EPS = 1e-6

export interface StrokeOutlineOptions {
  width: number
  align: StrokeAlign
  join: CanvasLineJoin
  cap: CanvasLineCap
  miterLimit: number
  closed: boolean
  /**
   * The transform's per-axis scale, used to solve the fringe width per vertex:
   * a push along local normal `n` lands `|S·n|` device px away, so the fringe
   * length is `FRINGE_PX / length(vec2(n.x*scaleX, n.y*scaleY))`. Not a
   * pre-divided scalar, and not `sqrt(|det|)`: neither survives a strongly
   * anisotropic transform (see the guide's anisotropy note).
   */
  fringeScale: { x: number; y: number }
  /**
   * Device pixels per local unit, for adaptive arc flattening. The caller snaps
   * this to the geometric center of its scale bucket, so a cached outline is
   * never more than one quarter-octave from the scale it is drawn at.
   */
  scale: number
}

/** Where tessellated triangles land. Implement once, reuse for every path. */
export interface StrokeOutlineSink {
  /**
   * Add a vertex at `(x, y)` with premultiplied-ramp coverage `0..1`. Returns
   * its index.
   */
  vertex(x: number, y: number, coverage: number): number
  /**
   * Add one triangle by vertex index, in the order the sink expects for its
   * winding.
   */
  triangle(a: number, b: number, c: number): void
}

/** A plain-array {@link StrokeOutlineSink}, for caching and for tests. */
export class StrokeOutlineBuffer implements StrokeOutlineSink {
  readonly positions: number[] = []
  readonly coverage: number[] = []
  readonly indices: number[] = []

  vertex(x: number, y: number, coverage: number): number {
    const i = this.coverage.length
    this.positions.push(x, y)
    this.coverage.push(coverage)
    return i
  }

  triangle(a: number, b: number, c: number): void {
    this.indices.push(a, b, c)
  }
}

function dist(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(bx - ax, by - ay)
}

/**
 * Sanitize raw input before anything else. Every one of these is reachable from
 * ordinary SVG artwork (see the guide's stroke-outline section).
 */
function sanitize(
  pts: ArrayLike<number>,
  count: number,
  closed: boolean,
): { x: number[]; y: number[]; count: number } {
  const x: number[] = []
  const y: number[] = []
  for (let i = 0; i < count; i++) {
    const px = pts[i * 2]
    const py = pts[i * 2 + 1]
    const n = x.length
    if (n > 0 && dist(x[n - 1], y[n - 1], px, py) < EPS) continue
    x.push(px)
    y.push(py)
  }
  // A closed contour whose last point duplicates its first (every SVG `Z`
  // contour, see `flattenSvgPath`) has a zero-length closing segment with an
  // undefined tangent. Drop it; the walk below closes the loop itself.
  if (
    closed &&
    x.length > 1 &&
    dist(x[0], y[0], x[x.length - 1], y[y.length - 1]) < EPS
  ) {
    x.pop()
    y.pop()
  }
  return { x, y, count: x.length }
}

function signedArea(x: number[], y: number[], count: number): number {
  let a = 0
  for (let i = 0; i < count; i++) {
    const j = (i + 1) % count
    a += x[i] * y[j] - x[j] * y[i]
  }
  return a * 0.5
}

let warnedNonCenterAlign = false

/**
 * Resolve `align` against the input, falling back to `'center'` (with a
 * one-time dev warning) when the fallback alone keeps the border from
 * vanishing. An open contour has no inside: `'inside'`/`'outside'` are
 * meaningless on it. A closed contour with zero signed area (a bowtie) has `w *
 * sign(area)` equal to zero too, and "undefined, which side" is not a defense
 * when one of the two readings draws no border at all.
 */
function resolveAlign(
  align: StrokeAlign,
  closed: boolean,
  area: number,
): StrokeAlign {
  if (align === 'center') return align
  if (closed && Math.abs(area) > EPS) return align
  if (!warnedNonCenterAlign) {
    warnedNonCenterAlign = true
    console.warn(
      `strokeOutline: '${align}' alignment needs a closed contour with a well-defined winding; falling back to 'center'`,
    )
  }
  return 'center'
}

/**
 * Whether `align` would fall back to `'center'` for this input, the same test
 * {@link resolveAlign} runs, without tessellating or warning. `GpuGfx` calls
 * this to tick the HUD's `strokeAlignFallback` counter on every occurrence,
 * independent of the one-time console warning the real tessellation gives.
 */
export function wouldFallBackToCenter(
  pts: ArrayLike<number>,
  count: number,
  closed: boolean,
  align: StrokeAlign,
): boolean {
  if (align === 'center') return false
  const { x, y, count: n } = sanitize(pts, count, closed)
  if (!(closed && n >= 3)) return true
  return Math.abs(signedArea(x, y, n)) <= EPS
}

/**
 * Unit normal `(dir.y, -dir.x)`: outward for a CCW loop, standard "right of
 * travel".
 */
function normalOf(dx: number, dy: number): [number, number] {
  const len = Math.hypot(dx, dy)
  if (len < EPS) return [0, 0]
  return [dy / len, -dx / len]
}

/**
 * The miter intersection of two offset lines meeting at `(px, py)`, offset by
 * signed distance `d` along each segment's own normal. Falls back to the
 * segment-endpoint average when the directions are too close to opposite for
 * the intersection to be numerically meaningful (a near-reversal): this is the
 * accepted degenerate-overlap case, not a NaN.
 */
function miterPoint(
  px: number,
  py: number,
  prevDx: number,
  prevDy: number,
  nextDx: number,
  nextDy: number,
  d: number,
): [number, number] {
  const dot = prevDx * nextDx + prevDy * nextDy
  const [pnx, pny] = normalOf(prevDx, prevDy)
  const [nnx, nny] = normalOf(nextDx, nextDy)
  if (dot < -0.9999) {
    return [px + ((pnx + nnx) * d) / 2, py + ((pny + nny) * d) / 2]
  }
  // Half-angle miter length: for unit normals n0, n1 and the bisector between
  // them, the miter distance from the joint is d / cos(theta/2), which in
  // terms of the normals alone is 2d / |n0 + n1|.
  const bx = pnx + nnx
  const by = pny + nny
  const bLen2 = bx * bx + by * by
  if (bLen2 < EPS) {
    return [px + ((pnx + nnx) * d) / 2, py + ((pny + nny) * d) / 2]
  }
  const k = (2 * d) / bLen2
  return [px + bx * k, py + by * k]
}

/**
 * Miter length in units of `|d|` (1 at a straight line, growing with
 * sharpness).
 */
function miterRatio(
  prevDx: number,
  prevDy: number,
  nextDx: number,
  nextDy: number,
): number {
  const [pnx, pny] = normalOf(prevDx, prevDy)
  const [nnx, nny] = normalOf(nextDx, nextDy)
  const bLen = Math.hypot(pnx + nnx, pny + nny)
  return bLen < EPS ? Infinity : 2 / bLen
}

/**
 * Adaptive angular step for a round join/cap of local radius `r` at device
 * scale `scale`.
 */
function arcStep(r: number, scale: number): number {
  const rs = Math.max(r * scale, EPS)
  const cosArg = Math.max(-1, Math.min(1, 1 - ARC_TOL_PX / rs))
  return Math.max(ARC_STEP_MIN, Math.min(ARC_STEP_MAX, Math.acos(cosArg)))
}

/**
 * Interior points of a circular arc from `(fromX,fromY)` to `(toX,toY)` around
 * `(cx,cy)`, radius `r`, the short way.
 */
function arcPoints(
  cx: number,
  cy: number,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  r: number,
  scale: number,
): number[] {
  const a0 = Math.atan2(fromY - cy, fromX - cx)
  let a1 = Math.atan2(toY - cy, toX - cx)
  let delta = a1 - a0
  while (delta > Math.PI) delta -= 2 * Math.PI
  while (delta < -Math.PI) delta += 2 * Math.PI
  a1 = a0 + delta
  const step = arcStep(r, scale)
  const steps = Math.max(1, Math.ceil(Math.abs(delta) / step))
  const out: number[] = []
  for (let i = 1; i < steps; i++) {
    const a = a0 + (delta * i) / steps
    out.push(cx + r * Math.cos(a), cy + r * Math.sin(a))
  }
  return out
}

/**
 * Append the join geometry between segment `(prevDx,prevDy)`'s offset end and
 * segment `(nextDx,nextDy)`'s offset start, meeting at original point
 * `(px,py)`, offset distance `d`. `isConvex` (this offset side bulges outward
 * at this joint) picks the join style; the concave side always collapses to the
 * exact miter intersection, which is what keeps that side watertight rather
 * than gapped.
 */
function appendJoin(
  out: number[],
  px: number,
  py: number,
  prevDx: number,
  prevDy: number,
  nextDx: number,
  nextDy: number,
  d: number,
  isConvex: boolean,
  join: CanvasLineJoin,
  miterLimit: number,
  scale: number,
): void {
  const prevEndX = px + normalOf(prevDx, prevDy)[0] * d
  const prevEndY = py + normalOf(prevDx, prevDy)[1] * d
  const nextStartX = px + normalOf(nextDx, nextDy)[0] * d
  const nextStartY = py + normalOf(nextDx, nextDy)[1] * d
  if (!isConvex) {
    const [mx, my] = miterPoint(px, py, prevDx, prevDy, nextDx, nextDy, d)
    out.push(mx, my)
    return
  }
  if (join === 'round') {
    out.push(prevEndX, prevEndY)
    out.push(
      ...arcPoints(
        px,
        py,
        prevEndX,
        prevEndY,
        nextStartX,
        nextStartY,
        Math.abs(d),
        scale,
      ),
    )
    out.push(nextStartX, nextStartY)
    return
  }
  if (join === 'miter') {
    const ratio = miterRatio(prevDx, prevDy, nextDx, nextDy)
    if (ratio <= miterLimit) {
      const [mx, my] = miterPoint(px, py, prevDx, prevDy, nextDx, nextDy, d)
      out.push(mx, my)
      return
    }
  }
  // Bevel, or miter past its limit.
  out.push(prevEndX, prevEndY, nextStartX, nextStartY)
}

/**
 * Build one offset polyline/loop at signed distance `d` along each segment's
 * own `(dir.y, -dir.x)` normal. Open (`!closed`) returns the offset endpoints
 * with interior joins only; closed wraps the join at the seam too, with no
 * start/end points of its own.
 */
function buildOffsetLoop(
  x: number[],
  y: number[],
  count: number,
  closed: boolean,
  d: number,
  join: CanvasLineJoin,
  miterLimit: number,
  scale: number,
): number[] {
  const segCount = closed ? count : count - 1
  const dirs: Array<[number, number]> = []
  for (let i = 0; i < segCount; i++) {
    const j = (i + 1) % count
    const dx = x[j] - x[i]
    const dy = y[j] - y[i]
    const len = Math.hypot(dx, dy) || 1
    dirs.push([dx / len, dy / len])
  }
  const out: number[] = []
  // One slot per ORIGINAL point: an open contour's first/last points are
  // plain offset endpoints (no join, nothing to reconcile), every other
  // slot is a join between the segment ending there and the one starting
  // there (for a closed contour, that includes the wraparound seam at k=0).
  for (let k = 0; k < count; k++) {
    if (!closed && k === 0) {
      const [dx, dy] = dirs[0]
      const [nx, ny] = normalOf(dx, dy)
      out.push(x[0] + nx * d, y[0] + ny * d)
      continue
    }
    if (!closed && k === count - 1) {
      const [dx, dy] = dirs[segCount - 1]
      const [nx, ny] = normalOf(dx, dy)
      out.push(x[count - 1] + nx * d, y[count - 1] + ny * d)
      continue
    }
    const prevIdx = closed ? (k - 1 + segCount) % segCount : k - 1
    const nextIdx = closed ? k % segCount : k
    const [prevDx, prevDy] = dirs[prevIdx]
    const [nextDx, nextDy] = dirs[nextIdx]
    const cross = prevDx * nextDy - prevDy * nextDx
    if (Math.abs(cross) < EPS) {
      // Straight through, or a 180-degree reversal. Either way there is no
      // real corner to join: emit the shared offset point once. A reversal's
      // overlap (if the two sides fold back onto each other) is the same
      // accepted degenerate case as a sharp concave corner.
      const [nx, ny] = normalOf(prevDx, prevDy)
      out.push(x[k] + nx * d, y[k] + ny * d)
      continue
    }
    const isConvex = d * cross < 0
    appendJoin(
      out,
      x[k],
      y[k],
      prevDx,
      prevDy,
      nextDx,
      nextDy,
      d,
      isConvex,
      join,
      miterLimit,
      scale,
    )
  }
  return out
}

/**
 * A cap's extra geometry, connecting `sideAEnd` to `sideBEnd` around `(px,py)`
 * facing `(dirX,dirY)` (pointing away from the contour).
 */
function appendCap(
  out: number[],
  px: number,
  py: number,
  dirX: number,
  dirY: number,
  halfW: number,
  cap: CanvasLineCap,
  scale: number,
  sideAEndX: number,
  sideAEndY: number,
  sideBEndX: number,
  sideBEndY: number,
): void {
  out.push(sideAEndX, sideAEndY)
  if (cap === 'round') {
    out.push(
      ...arcPoints(
        px,
        py,
        sideAEndX,
        sideAEndY,
        sideBEndX,
        sideBEndY,
        halfW,
        scale,
      ),
    )
  } else if (cap === 'square') {
    out.push(sideAEndX + dirX * halfW, sideAEndY + dirY * halfW)
    out.push(sideBEndX + dirX * halfW, sideBEndY + dirY * halfW)
  }
  out.push(sideBEndX, sideBEndY)
}

/**
 * Push every vertex of a closed loop along its own outward bisector normal by
 * the anisotropic fringe length. `direction` is `1` to push away from the
 * loop's own enclosed area (an outer boundary) or `-1` to push into it (a hole
 * boundary, so the fringe softens toward the hole rather than into the filled
 * band). Join style is always a plain averaged bevel: a fringe ring is about a
 * pixel wide, where the exact corner treatment is invisible.
 */
function fringeLoop(
  loopX: number[],
  loopY: number[],
  fringeScale: { x: number; y: number },
  direction: 1 | -1,
): { x: number[]; y: number[] } {
  const n = loopX.length
  const area = signedArea(loopX, loopY, n)
  const windingSign = area >= 0 ? 1 : -1
  const outX: number[] = new Array(n)
  const outY: number[] = new Array(n)
  for (let i = 0; i < n; i++) {
    const prev = (i - 1 + n) % n
    const next = (i + 1) % n
    const d0x = loopX[i] - loopX[prev]
    const d0y = loopY[i] - loopY[prev]
    const d1x = loopX[next] - loopX[i]
    const d1y = loopY[next] - loopY[i]
    const [n0x, n0y] = normalOf(d0x, d0y)
    const [n1x, n1y] = normalOf(d1x, d1y)
    let bx = (n0x + n1x) * windingSign * direction
    let by = (n0y + n1y) * windingSign * direction
    const bLen = Math.hypot(bx, by)
    if (bLen < EPS) {
      bx = n0x * windingSign * direction
      by = n0y * windingSign * direction
    } else {
      bx /= bLen
      by /= bLen
    }
    const scaledLen = Math.hypot(bx * fringeScale.x, by * fringeScale.y)
    const push = scaledLen < EPS ? 0 : FRINGE_PX / scaledLen
    outX[i] = loopX[i] + bx * push
    outY[i] = loopY[i] + by * push
  }
  return { x: outX, y: outY }
}

/**
 * Triangulate `loop` (flat x,y) and emit its core triangles at coverage 1, then
 * ring a fringe around it.
 */
function emitLoopWithFringe(
  out: StrokeOutlineSink,
  loopX: number[],
  loopY: number[],
  holeX: number[] | null,
  holeY: number[] | null,
  fringeScale: { x: number; y: number },
): void {
  const n = loopX.length
  const flat: number[] = []
  for (let i = 0; i < n; i++) flat.push(loopX[i], loopY[i])
  const holeIndices: number[] = []
  if (holeX && holeY && holeX.length >= 3) {
    holeIndices.push(n)
    for (let i = 0; i < holeX.length; i++) flat.push(holeX[i], holeY[i])
  }
  const tris =
    flat.length >= 6
      ? earcut(flat, holeIndices.length ? holeIndices : undefined)
      : []
  const coreIdx: number[] = new Array(flat.length / 2)
  for (let i = 0; i < coreIdx.length; i++) {
    coreIdx[i] = out.vertex(flat[i * 2], flat[i * 2 + 1], 1)
  }
  for (let i = 0; i < tris.length; i += 3) {
    out.triangle(coreIdx[tris[i]], coreIdx[tris[i + 1]], coreIdx[tris[i + 2]])
  }
  const outerFringe = fringeLoop(loopX, loopY, fringeScale, 1)
  ringFringe(out, n, outerFringe.x, outerFringe.y, coreIdx)
  if (holeX && holeY && holeX.length >= 3) {
    const innerFringe = fringeLoop(holeX, holeY, fringeScale, -1)
    const holeCore = coreIdx.slice(n)
    ringFringe(out, holeX.length, innerFringe.x, innerFringe.y, holeCore)
  }
}

/**
 * Emit the fringe quads between a core loop (coverage 1, already in the sink at
 * `coreIdx`) and its pushed-out twin (coverage 0).
 */
function ringFringe(
  out: StrokeOutlineSink,
  n: number,
  fringeX: number[],
  fringeY: number[],
  coreIdx: number[],
): void {
  const fIdx: number[] = new Array(n)
  for (let i = 0; i < n; i++) fIdx[i] = out.vertex(fringeX[i], fringeY[i], 0)
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    out.triangle(coreIdx[i], coreIdx[j], fIdx[j])
    out.triangle(coreIdx[i], fIdx[j], fIdx[i])
  }
}

/**
 * Tessellate a stroke into `out`. Local coordinates in, local coordinates out:
 * the caller CPU-transforms the sink's vertices into device px, same as any
 * other streamed fill, so the expensive part (this function) is what a per-path
 * cache keys on.
 *
 * @example
 *   const buf = new StrokeOutlineBuffer()
 *   strokeOutline(
 *     points,
 *     count,
 *     {
 *       width: 3,
 *       align: 'outside',
 *       join: 'miter',
 *       cap: 'round',
 *       miterLimit: DEFAULT_MITER_LIMIT,
 *       closed: true,
 *       fringeScale: { x: scaleX, y: scaleY },
 *       scale,
 *     },
 *     buf,
 *   )
 */
export function strokeOutline(
  pts: ArrayLike<number>,
  count: number,
  opts: StrokeOutlineOptions,
  out: StrokeOutlineSink,
): void {
  if (opts.width <= 0 || count < 2) return
  const { x, y, count: n } = sanitize(pts, count, opts.closed)
  if (n < 2) return
  const closed = opts.closed && n >= 3
  const area = closed ? signedArea(x, y, n) : 0
  const align = resolveAlign(opts.align, closed, area)
  const halfW = opts.width / 2
  const windingSign = area >= 0 ? 1 : -1

  if (!closed) {
    // Only 'center' survives `resolveAlign` for an open contour.
    const sideA = buildOffsetLoop(
      x,
      y,
      n,
      false,
      halfW,
      opts.join,
      opts.miterLimit,
      opts.scale,
    )
    const sideB = buildOffsetLoop(
      x,
      y,
      n,
      false,
      -halfW,
      opts.join,
      opts.miterLimit,
      opts.scale,
    )
    const loop: number[] = [...sideA]
    const lastDx = x[n - 1] - x[n - 2]
    const lastDy = y[n - 1] - y[n - 2]
    const lastLen = Math.hypot(lastDx, lastDy) || 1
    appendCap(
      loop,
      x[n - 1],
      y[n - 1],
      lastDx / lastLen,
      lastDy / lastLen,
      halfW,
      opts.cap,
      opts.scale,
      sideA[sideA.length - 2],
      sideA[sideA.length - 1],
      sideB[sideB.length - 2],
      sideB[sideB.length - 1],
    )
    for (let i = sideB.length - 4; i >= 0; i -= 2)
      loop.push(sideB[i], sideB[i + 1])
    const firstDx = x[0] - x[1]
    const firstDy = y[0] - y[1]
    const firstLen = Math.hypot(firstDx, firstDy) || 1
    appendCap(
      loop,
      x[0],
      y[0],
      firstDx / firstLen,
      firstDy / firstLen,
      halfW,
      opts.cap,
      opts.scale,
      sideB[0],
      sideB[1],
      sideA[0],
      sideA[1],
    )
    const loopX: number[] = []
    const loopY: number[] = []
    for (let i = 0; i < loop.length; i += 2) {
      loopX.push(loop[i])
      loopY.push(loop[i + 1])
    }
    emitLoopWithFringe(out, loopX, loopY, null, null, opts.fringeScale)
    return
  }

  // Closed: the offset distance for each edge depends on alignment, signed
  // along the outward normal (`windingSign` makes "outward" absolute rather
  // than tied to `(dir.y,-dir.x)`'s own sign convention).
  const outerDist =
    align === 'inside' ? 0 : align === 'outside' ? opts.width : halfW
  const innerDist =
    align === 'inside' ? -opts.width : align === 'outside' ? 0 : -halfW
  const outerOffset = outerDist * windingSign
  const innerOffset = innerDist * windingSign

  let outerX: number[]
  let outerY: number[]
  if (Math.abs(outerDist) < EPS) {
    outerX = x.slice()
    outerY = y.slice()
  } else {
    const flat = buildOffsetLoop(
      x,
      y,
      n,
      true,
      outerOffset,
      opts.join,
      opts.miterLimit,
      opts.scale,
    )
    outerX = []
    outerY = []
    for (let i = 0; i < flat.length; i += 2) {
      outerX.push(flat[i])
      outerY.push(flat[i + 1])
    }
  }

  if (Math.abs(outerDist - innerDist) < EPS) {
    // Degenerate zero-width band: nothing to fill.
    return
  }

  let innerFlatX: number[]
  let innerFlatY: number[]
  if (Math.abs(innerDist) < EPS) {
    innerFlatX = x.slice()
    innerFlatY = y.slice()
  } else {
    const flat = buildOffsetLoop(
      x,
      y,
      n,
      true,
      innerOffset,
      opts.join,
      opts.miterLimit,
      opts.scale,
    )
    innerFlatX = []
    innerFlatY = []
    for (let i = 0; i < flat.length; i += 2) {
      innerFlatX.push(flat[i])
      innerFlatY.push(flat[i + 1])
    }
  }
  // Reverse for earcut's hole convention (opposite winding from the outer ring).
  const innerX = innerFlatX.slice().reverse()
  const innerY = innerFlatY.slice().reverse()
  emitLoopWithFringe(out, outerX, outerY, innerX, innerY, opts.fringeScale)
}
