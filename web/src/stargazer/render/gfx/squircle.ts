/**
 * Smooth corners for rounded rectangles: Figma's corner smoothing, where 0 is a
 * circular corner and 0.6 matches the iOS app icon shape.
 *
 * A smoothed corner keeps a circular arc around the same center as the plain
 * corner, but a shorter one, and eases into each straight side through a cubic
 * Bézier instead of meeting it abruptly. It uses more of each side than the
 * plain corner, `(1 + smoothing) * radius`. When a side is too short for that,
 * smoothing is reduced before the radius is, as Figma does.
 *
 * The construction follows the Figma article "Desperately seeking squircles"
 * and the published port of its code, `figma-squircle`.
 */
import {
  flattenSvgPath,
  tessellateContours,
} from '../../assets/SvgPathContours'
import type { GfxPath } from './GfxPath'
import { registerPathTessellation } from './PathTessellationRegistry'
import { expandRadii, type RoundRectRadii } from './roundRectRadii'

/** The corner smoothing that matches the iOS app icon shape. */
export const IOS_CORNER_SMOOTHING = 0.6

/** One smoothed corner, in the units of the rectangle it belongs to. */
export interface SquircleCorner {
  /** Radius of the circular arc, after fitting the rectangle. */
  radius: number
  /** Smoothing after fitting the rectangle, from 0 to 1. */
  smoothing: number
  /** How much of each side the corner uses, measured from the corner point. */
  extent: number
  /** Lengths along the side for the easing curve's handles (Figma's a, b, c, d). */
  a: number
  b: number
  c: number
  d: number
  /** Horizontal and vertical span of the circular arc. */
  arcSpan: number
}

const DEG = Math.PI / 180

/**
 * The shape of one corner with `radius` and `smoothing`, fitted to `budget`,
 * the length of side it may use. Matches `getPathParamsForCorner` in
 * `figma-squircle` without its `preserveSmoothing` option.
 */
export function squircleCorner(
  radius: number,
  smoothing: number,
  budget: number,
): SquircleCorner {
  let fitted = Math.min(Math.max(smoothing, 0), 1)
  let extent = (1 + fitted) * radius
  if (radius > 0) {
    fitted = Math.max(0, Math.min(fitted, budget / radius - 1))
    extent = Math.min(extent, budget)
  }
  const arcDegrees = 90 * (1 - fitted)
  const arcSpan = Math.sin((arcDegrees / 2) * DEG) * radius * Math.SQRT2
  // Where the easing curve's last handle sits relative to the arc's start.
  const handleAngle = (90 - arcDegrees) / 2
  const arcToHandle = radius * Math.tan((handleAngle / 2) * DEG)
  const tilt = 45 * fitted * DEG
  const c = arcToHandle * Math.cos(tilt)
  const d = c * Math.tan(tilt)
  // The rest of the easing curve's length, two thirds before its middle handle
  // and one third after.
  const b = (extent - arcSpan - c - d) / 3
  return { radius, smoothing: fitted, extent, a: 2 * b, b, c, d, arcSpan }
}

// Corners in order tl, tr, br, bl. Each touches a horizontal side, shared with
// the corner in `ACROSS_WIDTH`, and a vertical side, shared with the corner in
// `ACROSS_HEIGHT`.
const ACROSS_WIDTH = [1, 0, 3, 2]
const ACROSS_HEIGHT = [3, 2, 1, 0]
const scratchExpanded: [number, number, number, number] = [0, 0, 0, 0]
const scratchBudgets = [0, 0, 0, 0]
const scratchOrder = [0, 1, 2, 3]

/**
 * Fit the corners of a `w` × `h` rectangle, radii in the CSS shorthand, the way
 * Figma does: each corner gets a share of its two sides in proportion to its
 * radius, larger corners first, and keeps the smaller of the two. Writes each
 * corner's radius and smoothing after fitting, clockwise from the top left,
 * into `outRadii` and `outSmoothing`, and each corner's share of side into
 * `outBudgets` when given. Allocates nothing. Matches `figma-squircle`.
 */
export function fitSquircleCorners(
  w: number,
  h: number,
  radii: RoundRectRadii,
  smoothing: number,
  outRadii: [number, number, number, number],
  outSmoothing: [number, number, number, number],
  outBudgets: number[] = scratchBudgets,
): void {
  const expanded = expandRadii(radii, scratchExpanded)
  for (let i = 0; i < 4; i++) expanded[i] = Math.max(0, expanded[i])
  if (
    expanded[0] === expanded[1] &&
    expanded[1] === expanded[2] &&
    expanded[2] === expanded[3]
  ) {
    const budget = Math.max(0, Math.min(w, h) / 2)
    for (let i = 0; i < 4; i++) {
      outBudgets[i] = budget
      outRadii[i] = Math.min(expanded[0], budget)
    }
  } else {
    for (let i = 0; i < 4; i++) outBudgets[i] = -1
    scratchOrder.sort((i, j) => expanded[j] - expanded[i])
    for (const corner of scratchOrder) {
      const radius = expanded[corner]
      const horizontal = ACROSS_WIDTH[corner]
      const vertical = ACROSS_HEIGHT[corner]
      const budget = Math.min(
        shareOfSide(radius, expanded[horizontal], outBudgets[horizontal], w),
        shareOfSide(radius, expanded[vertical], outBudgets[vertical], h),
      )
      outBudgets[corner] = budget
      outRadii[corner] = Math.min(radius, budget)
    }
  }
  const wanted = Math.min(Math.max(smoothing, 0), 1)
  for (let i = 0; i < 4; i++) {
    const radius = outRadii[i]
    outSmoothing[i] =
      radius > 0 ? Math.max(0, Math.min(wanted, outBudgets[i] / radius - 1)) : 0
  }
}

/**
 * How much of a side of length `side` a corner of `radius` may use, next to a
 * corner of `neighborRadius` that has already taken `neighborBudget` of it, or
 * that has not been fitted yet when that is negative.
 */
function shareOfSide(
  radius: number,
  neighborRadius: number,
  neighborBudget: number,
  side: number,
): number {
  if (radius === 0 && neighborRadius === 0) return 0
  if (neighborBudget >= 0) return side - neighborBudget
  return (radius / (radius + neighborRadius)) * side
}

/**
 * The four corners of a `w` × `h` rectangle, clockwise from the top left, with
 * radii in the CSS shorthand, fitted as {@link fitSquircleCorners} does.
 */
export function squircleCorners(
  w: number,
  h: number,
  radii: RoundRectRadii,
  smoothing: number,
): [SquircleCorner, SquircleCorner, SquircleCorner, SquircleCorner] {
  const fitted: [number, number, number, number] = [0, 0, 0, 0]
  const fittedSmoothing: [number, number, number, number] = [0, 0, 0, 0]
  const budgets = [0, 0, 0, 0]
  fitSquircleCorners(w, h, radii, smoothing, fitted, fittedSmoothing, budgets)
  return [0, 1, 2, 3].map((i) =>
    squircleCorner(fitted[i], smoothing, budgets[i]),
  ) as [SquircleCorner, SquircleCorner, SquircleCorner, SquircleCorner]
}

const shadowRadiusScales = new Map<number, number>()

/**
 * The radius of the circular corner that cuts as much off the corner point as a
 * smoothed corner of radius 1 does. The analytic shadow only has circular
 * corners, so a smooth-cornered shape's shadow uses each corner's radius times
 * this. Cached per hundredth of smoothing.
 */
export function squircleShadowRadiusScale(smoothing: number): number {
  const key = Math.round(Math.min(Math.max(smoothing, 0), 1) * 100)
  const cached = shadowRadiusScales.get(key)
  if (cached !== undefined) return cached
  const corner = squircleCorner(1, key / 100, 2)
  // Area between the corner point and the curve, by the shoelace formula over
  // the corner point, the curve's start on the top side, the flattened curve
  // and its end on the right side, relative to the top right corner point.
  const steps = 64
  let area = 0
  let px = 0
  let py = 0
  let x = -corner.extent
  let y = 0
  area += px * y - x * py
  px = x
  py = y
  for (const [c1x, c1y, c2x, c2y, ex, ey] of squircleCornerCurves(corner)) {
    for (let i = 1; i <= steps; i++) {
      const t = i / steps
      const u = 1 - t
      const qx =
        u * u * u * x +
        3 * u * u * t * c1x +
        3 * u * t * t * c2x +
        t * t * t * ex
      const qy =
        u * u * u * y +
        3 * u * u * t * c1y +
        3 * u * t * t * c2y +
        t * t * t * ey
      area += px * qy - qx * py
      px = qx
      py = qy
    }
    x = ex
    y = ey
  }
  area += px * 0 - 0 * py
  const scale = Math.sqrt(Math.abs(area / 2) / (1 - Math.PI / 4))
  shadowRadiusScales.set(key, scale)
  return scale
}

/** Receives a squircle outline one segment at a time. */
interface OutlineSink {
  moveTo(x: number, y: number): void
  lineTo(x: number, y: number): void
  cubicTo(
    c1x: number,
    c1y: number,
    c2x: number,
    c2y: number,
    x: number,
    y: number,
  ): void
  close(): void
}

/**
 * The top right corner's outline as cubic segments, relative to the corner
 * point, running clockwise from the top side down to the right side (y down).
 * Each segment is `[c1x, c1y, c2x, c2y, x, y]` and starts where the previous
 * one ended, the first at `(-extent, 0)`. The other corners are this one
 * rotated. The circular arc becomes one cubic, which for an arc of 90 degrees
 * or less is within 0.03% of the radius.
 */
export function squircleCornerCurves(corner: SquircleCorner): number[][] {
  const { radius, extent, a, b, c, d, arcSpan } = corner
  if (radius <= 0) return []
  const arcStart = [-extent + a + b + c, d]
  const arcEnd = [arcStart[0] + arcSpan, arcStart[1] + arcSpan]
  // The arc is centered where a plain corner of this radius would be.
  const center = [-radius, radius]
  const arcDegrees = 90 * (1 - corner.smoothing)
  const handle = (4 / 3) * Math.tan((arcDegrees * DEG) / 4) * radius
  // Clockwise tangents at the arc's ends, perpendicular to their radii.
  const startTangent = [
    -(arcStart[1] - center[1]) / radius,
    (arcStart[0] - center[0]) / radius,
  ]
  const endTangent = [
    -(arcEnd[1] - center[1]) / radius,
    (arcEnd[0] - center[0]) / radius,
  ]
  return [
    [-extent + a, 0, -extent + a + b, 0, arcStart[0], arcStart[1]],
    [
      arcStart[0] + startTangent[0] * handle,
      arcStart[1] + startTangent[1] * handle,
      arcEnd[0] - endTangent[0] * handle,
      arcEnd[1] - endTangent[1] * handle,
      arcEnd[0],
      arcEnd[1],
    ],
    [
      arcEnd[0] + d,
      arcEnd[1] + c,
      arcEnd[0] + d,
      arcEnd[1] + b + c,
      arcEnd[0] + d,
      arcEnd[1] + a + b + c,
    ],
  ]
}

function traceSquircle(
  sink: OutlineSink,
  x: number,
  y: number,
  w: number,
  h: number,
  radii: RoundRectRadii,
  smoothing: number,
): void {
  const corners = squircleCorners(w, h, radii, smoothing)
  // Corner points clockwise from the top right, each with the rotation that
  // turns the top right corner into it: (x, y) -> (cos * x - sin * y, ...).
  const placements = [
    { corner: corners[1], at: [x + w, y], cos: 1, sin: 0 },
    { corner: corners[2], at: [x + w, y + h], cos: 0, sin: 1 },
    { corner: corners[3], at: [x, y + h], cos: -1, sin: 0 },
    { corner: corners[0], at: [x, y], cos: 0, sin: -1 },
  ]
  const place = (p: (typeof placements)[number], px: number, py: number) => [
    p.at[0] + p.cos * px - p.sin * py,
    p.at[1] + p.sin * px + p.cos * py,
  ]
  const first = placements[0]
  const [startX, startY] = place(first, -first.corner.extent, 0)
  sink.moveTo(startX, startY)
  for (const placement of placements) {
    const [edgeX, edgeY] = place(placement, -placement.corner.extent, 0)
    sink.lineTo(edgeX, edgeY)
    for (const s of squircleCornerCurves(placement.corner)) {
      const [c1x, c1y] = place(placement, s[0], s[1])
      const [c2x, c2y] = place(placement, s[2], s[3])
      const [ex, ey] = place(placement, s[4], s[5])
      sink.cubicTo(c1x, c1y, c2x, c2y, ex, ey)
    }
  }
  sink.close()
}

/**
 * Append the outline of a smooth-cornered rectangle to `path`: `x`, `y` is its
 * top left corner, radii are in the CSS shorthand, and `smoothing` runs from 0
 * (circular corners) to 1. Returns `path`.
 *
 * @example
 *   // An iOS app icon shape, as a clip for a node's content.
 *   node.clip = squirclePath(
 *     new GfxPath(),
 *     0,
 *     0,
 *     120,
 *     120,
 *     27,
 *     IOS_CORNER_SMOOTHING,
 *   )
 */
export function squirclePath(
  path: GfxPath,
  x: number,
  y: number,
  w: number,
  h: number,
  radii: RoundRectRadii,
  smoothing: number,
): GfxPath {
  traceSquircle(
    {
      moveTo: (px, py) => path.moveTo(px, py),
      lineTo: (px, py) => path.lineTo(px, py),
      cubicTo: (a, b, c, d, e, f) => path.cubicTo(a, b, c, d, e, f),
      close: () => path.close(),
    },
    x,
    y,
    w,
    h,
    radii,
    smoothing,
  )
  return path
}

/**
 * The outline of a smooth-cornered rectangle as SVG path data, for a `Path2D`
 * or `parseSvgPaths`. Arguments as for {@link squirclePath}.
 */
export function squircleSvgPath(
  x: number,
  y: number,
  w: number,
  h: number,
  radii: RoundRectRadii,
  smoothing: number,
): string {
  const parts: string[] = []
  const n = (v: number) => String(Math.round(v * 10000) / 10000)
  traceSquircle(
    {
      moveTo: (px, py) => parts.push(`M${n(px)} ${n(py)}`),
      lineTo: (px, py) => parts.push(`L${n(px)} ${n(py)}`),
      cubicTo: (a, b, c, d, e, f) =>
        parts.push(`C${n(a)} ${n(b)} ${n(c)} ${n(d)} ${n(e)} ${n(f)}`),
      close: () => parts.push('Z'),
    },
    x,
    y,
    w,
    h,
    radii,
    smoothing,
  )
  return parts.join(' ')
}

/**
 * The outline of a smooth-cornered rectangle as a `Path2D`, with its
 * tessellation registered so a `Path2DNode` or `shadowPath2D` can draw it.
 * Arguments as for {@link squirclePath}.
 *
 * @example
 *   const card = squirclePath2D(0, 0, 200, 120, 24, IOS_CORNER_SMOOTHING)
 *   scene.root.add(new Path2DNode({ path: card, fill: '#fff', shadow }))
 */
export function squirclePath2D(
  x: number,
  y: number,
  w: number,
  h: number,
  radii: RoundRectRadii,
  smoothing: number,
): Path2D {
  const d = squircleSvgPath(x, y, w, h, radii, smoothing)
  const path = new Path2D(d)
  // A quarter pixel of flattening error keeps the edge true at 1:1.
  const contours = flattenSvgPath(d, 0.25)
  registerPathTessellation(path, tessellateContours(contours), contours)
  return path
}
