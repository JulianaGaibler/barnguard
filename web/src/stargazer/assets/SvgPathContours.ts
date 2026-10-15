/**
 * SVG path -> flattened polylines -> triangulated geometry.
 *
 * - `flattenSvgPath(d, tol)` load-time, one contour per `M`.
 * - `flattenQuadratic` / `flattenCubic` live, zero-alloc subdivision into a
 *   caller-owned `Float32Array`. Safe on the render hot path.
 * - `tessellateContours(contours)` runs `earcut`. Uint16 indexing, throws above
 *   65 535 verts per shape.
 *
 * Flatness = midpoint deviation from chord. Tolerance is in input coordinate
 * space, callers convert pixel tolerance via the current transform's scale.
 */

import earcut from 'earcut'
import type { GeometryHandle } from '../render/gfx/GeometryHandle'
import { tokenizeSvgPath } from './SvgPathMap'

// Cap subdivision depth so pathological curves don't hang. ~13 levels
// covers a 4K screen at 0.5-px tolerance, 16 gives comfortable margin.
const MAX_SUBDIV_DEPTH = 16

// Live Bézier flatteners

/**
 * Flatten a quadratic Bézier. `(x0,y0)` MUST already be at
 * `out[cursor-2..cursor-1]`, this only appends intermediate points and the
 * endpoint. Returns the new cursor (in floats).
 */
export function flattenQuadratic(
  x0: number,
  y0: number,
  cx: number,
  cy: number,
  x1: number,
  y1: number,
  tol: number,
  out: Float32Array,
  cursor: number,
): number {
  return subdivideQuad(x0, y0, cx, cy, x1, y1, tol, out, cursor, 0)
}

function subdivideQuad(
  x0: number,
  y0: number,
  cx: number,
  cy: number,
  x1: number,
  y1: number,
  tol: number,
  out: Float32Array,
  cursor: number,
  depth: number,
): number {
  // Flatness metric: distance from control point to chord midpoint.
  // Equivalent to the standard quadratic subdivision test.
  const dx = x1 - x0
  const dy = y1 - y0
  // Squared perpendicular distance from (cx,cy) to line (x0,y0)-(x1,y1).
  const cross = (cx - x0) * dy - (cy - y0) * dx
  const denom = dx * dx + dy * dy
  const distSq = denom > 0 ? (cross * cross) / denom : 0
  if (distSq <= tol * tol || depth >= MAX_SUBDIV_DEPTH) {
    if (cursor + 2 > out.length) return cursor
    out[cursor++] = x1
    out[cursor++] = y1
    return cursor
  }
  // de Casteljau split at t = 0.5.
  const l1x = (x0 + cx) * 0.5
  const l1y = (y0 + cy) * 0.5
  const r1x = (cx + x1) * 0.5
  const r1y = (cy + y1) * 0.5
  const mx = (l1x + r1x) * 0.5
  const my = (l1y + r1y) * 0.5
  cursor = subdivideQuad(x0, y0, l1x, l1y, mx, my, tol, out, cursor, depth + 1)
  cursor = subdivideQuad(mx, my, r1x, r1y, x1, y1, tol, out, cursor, depth + 1)
  return cursor
}

/**
 * Flatten a cubic Bézier. Same contract as `flattenQuadratic`, the start point
 * is assumed already present. Only intermediate and end points are appended.
 */
export function flattenCubic(
  x0: number,
  y0: number,
  c1x: number,
  c1y: number,
  c2x: number,
  c2y: number,
  x1: number,
  y1: number,
  tol: number,
  out: Float32Array,
  cursor: number,
): number {
  return subdivideCubic(x0, y0, c1x, c1y, c2x, c2y, x1, y1, tol, out, cursor, 0)
}

function subdivideCubic(
  x0: number,
  y0: number,
  c1x: number,
  c1y: number,
  c2x: number,
  c2y: number,
  x1: number,
  y1: number,
  tol: number,
  out: Float32Array,
  cursor: number,
  depth: number,
): number {
  // Flatness metric: max perpendicular distance from each control point to chord.
  const dx = x1 - x0
  const dy = y1 - y0
  const denom = dx * dx + dy * dy
  let distSq = 0
  if (denom > 0) {
    const c1Cross = (c1x - x0) * dy - (c1y - y0) * dx
    const c2Cross = (c2x - x0) * dy - (c2y - y0) * dx
    const d1Sq = (c1Cross * c1Cross) / denom
    const d2Sq = (c2Cross * c2Cross) / denom
    distSq = d1Sq > d2Sq ? d1Sq : d2Sq
  }
  if (distSq <= tol * tol || depth >= MAX_SUBDIV_DEPTH) {
    if (cursor + 2 > out.length) return cursor
    out[cursor++] = x1
    out[cursor++] = y1
    return cursor
  }
  // de Casteljau split at t = 0.5.
  const l1x = (x0 + c1x) * 0.5
  const l1y = (y0 + c1y) * 0.5
  const hx = (c1x + c2x) * 0.5
  const hy = (c1y + c2y) * 0.5
  const r2x = (c2x + x1) * 0.5
  const r2y = (c2y + y1) * 0.5
  const l2x = (l1x + hx) * 0.5
  const l2y = (l1y + hy) * 0.5
  const r1x = (hx + r2x) * 0.5
  const r1y = (hy + r2y) * 0.5
  const mx = (l2x + r1x) * 0.5
  const my = (l2y + r1y) * 0.5
  cursor = subdivideCubic(
    x0,
    y0,
    l1x,
    l1y,
    l2x,
    l2y,
    mx,
    my,
    tol,
    out,
    cursor,
    depth + 1,
  )
  cursor = subdivideCubic(
    mx,
    my,
    r1x,
    r1y,
    r2x,
    r2y,
    x1,
    y1,
    tol,
    out,
    cursor,
    depth + 1,
  )
  return cursor
}

// Path-string flattener

/**
 * Flatten an SVG `d` string into an array of contours. Each contour is a
 * `Float32Array` of interleaved `[x0,y0,x1,y1,…]` points. Closing `Z` emits the
 * closing segment, and a fresh `M` starts a new contour.
 *
 * Handles M/L/H/V/C/S/Q/T/A/Z (matches `computePathBounds`'s command set). `A`
 * (arc) is flattened as a straight line to the endpoint, no dynamic SVG in the
 * game uses arcs, but the fallback is safe.
 */
export function flattenSvgPath(d: string, tol: number): Float32Array[] {
  const tokens = tokenizeSvgPath(d)
  const contours: Float32Array[] = []
  // Growable buffer for the current contour, sealed on Z or new M.
  let buf = new Float32Array(64)
  let cursor = 0
  let cx = 0
  let cy = 0
  let startX = 0
  let startY = 0
  let prevCtrlX = 0
  let prevCtrlY = 0
  let prevCmd = ''
  let i = 0
  let cmd = ''

  const ensureCapacity = (extraFloats: number): void => {
    if (cursor + extraFloats > buf.length) {
      let cap = buf.length
      while (cap < cursor + extraFloats) cap *= 2
      const next = new Float32Array(cap)
      next.set(buf)
      buf = next
    }
  }
  const appendPoint = (x: number, y: number): void => {
    ensureCapacity(2)
    buf[cursor++] = x
    buf[cursor++] = y
  }
  const sealContour = (): void => {
    if (cursor >= 4) {
      contours.push(buf.slice(0, cursor))
    }
    buf = new Float32Array(64)
    cursor = 0
  }
  const num = (): number => parseFloat(tokens[i++])

  while (i < tokens.length) {
    const before = i
    const tok = tokens[i]
    if (/^[a-zA-Z]$/.test(tok)) {
      cmd = tok
      i++
    }
    if (i >= tokens.length) break
    const upper = cmd.toUpperCase()
    const abs = cmd === upper

    switch (upper) {
      case 'M': {
        // A new M starts a new contour.
        if (cursor > 0) sealContour()
        const x = num() + (abs ? 0 : cx)
        const y = num() + (abs ? 0 : cy)
        cx = x
        cy = y
        startX = x
        startY = y
        appendPoint(x, y)
        cmd = abs ? 'L' : 'l'
        break
      }
      case 'L': {
        const x = num() + (abs ? 0 : cx)
        const y = num() + (abs ? 0 : cy)
        cx = x
        cy = y
        appendPoint(x, y)
        break
      }
      case 'H': {
        const x = num() + (abs ? 0 : cx)
        cx = x
        appendPoint(x, cy)
        break
      }
      case 'V': {
        const y = num() + (abs ? 0 : cy)
        cy = y
        appendPoint(cx, y)
        break
      }
      case 'C': {
        const c1x = num() + (abs ? 0 : cx)
        const c1y = num() + (abs ? 0 : cy)
        const c2x = num() + (abs ? 0 : cx)
        const c2y = num() + (abs ? 0 : cy)
        const x = num() + (abs ? 0 : cx)
        const y = num() + (abs ? 0 : cy)
        ensureCapacity(2 + 2 * (1 << MAX_SUBDIV_DEPTH))
        cursor = flattenCubic(
          cx,
          cy,
          c1x,
          c1y,
          c2x,
          c2y,
          x,
          y,
          tol,
          buf,
          cursor,
        )
        cx = x
        cy = y
        prevCtrlX = c2x
        prevCtrlY = c2y
        prevCmd = 'C'
        break
      }
      case 'S': {
        // Smooth cubic: c1 = reflection of previous cubic's c2 (or current point).
        const c1x = prevCmd === 'C' || prevCmd === 'S' ? 2 * cx - prevCtrlX : cx
        const c1y = prevCmd === 'C' || prevCmd === 'S' ? 2 * cy - prevCtrlY : cy
        const c2x = num() + (abs ? 0 : cx)
        const c2y = num() + (abs ? 0 : cy)
        const x = num() + (abs ? 0 : cx)
        const y = num() + (abs ? 0 : cy)
        ensureCapacity(2 + 2 * (1 << MAX_SUBDIV_DEPTH))
        cursor = flattenCubic(
          cx,
          cy,
          c1x,
          c1y,
          c2x,
          c2y,
          x,
          y,
          tol,
          buf,
          cursor,
        )
        cx = x
        cy = y
        prevCtrlX = c2x
        prevCtrlY = c2y
        prevCmd = 'S'
        break
      }
      case 'Q': {
        const qcx = num() + (abs ? 0 : cx)
        const qcy = num() + (abs ? 0 : cy)
        const x = num() + (abs ? 0 : cx)
        const y = num() + (abs ? 0 : cy)
        ensureCapacity(2 + 2 * (1 << MAX_SUBDIV_DEPTH))
        cursor = flattenQuadratic(cx, cy, qcx, qcy, x, y, tol, buf, cursor)
        cx = x
        cy = y
        prevCtrlX = qcx
        prevCtrlY = qcy
        prevCmd = 'Q'
        break
      }
      case 'T': {
        // Smooth quadratic: control = reflection of previous quadratic's control.
        const qcx = prevCmd === 'Q' || prevCmd === 'T' ? 2 * cx - prevCtrlX : cx
        const qcy = prevCmd === 'Q' || prevCmd === 'T' ? 2 * cy - prevCtrlY : cy
        const x = num() + (abs ? 0 : cx)
        const y = num() + (abs ? 0 : cy)
        ensureCapacity(2 + 2 * (1 << MAX_SUBDIV_DEPTH))
        cursor = flattenQuadratic(cx, cy, qcx, qcy, x, y, tol, buf, cursor)
        cx = x
        cy = y
        prevCtrlX = qcx
        prevCtrlY = qcy
        prevCmd = 'T'
        break
      }
      case 'A': {
        // Skip params, treat arc as a line to endpoint (no dynamic node
        // uses arcs, this keeps the tessellator safe on unexpected input).
        num()
        num()
        num()
        num()
        num()
        const x = num() + (abs ? 0 : cx)
        const y = num() + (abs ? 0 : cy)
        appendPoint(x, y)
        cx = x
        cy = y
        break
      }
      case 'Z': {
        // Close contour: line back to start, then seal.
        if (cx !== startX || cy !== startY) appendPoint(startX, startY)
        cx = startX
        cy = startY
        sealContour()
        break
      }
      default:
        if (i < tokens.length) i++
        break
    }
    if (upper !== 'C' && upper !== 'S' && upper !== 'Q' && upper !== 'T') {
      prevCmd = upper
    }
    if (i === before) i++
  }

  if (cursor > 0) sealContour()
  return contours
}

// Triangulation

/**
 * Ray-cast point-in-polygon test, even-odd rule: count edge crossings of a ray
 * cast in the +x direction and read the parity. Works for any simple polygon
 * regardless of winding direction, open or implicitly closed.
 */
function pointInPolygon(x: number, y: number, poly: Float32Array): boolean {
  let inside = false
  const n = poly.length / 2
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = poly[i * 2]
    const yi = poly[i * 2 + 1]
    const xj = poly[j * 2]
    const yj = poly[j * 2 + 1]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside
    }
  }
  return inside
}

/**
 * A point strictly inside `contour`, close to the extreme vertex in the given
 * direction, treating the contour as its own filled region (ignoring whatever
 * other contours might subtract from it). That extreme vertex (minimum
 * coordinate for `'min'`, maximum for `'max'`, ties broken the same way on the
 * other axis) is convex regardless of winding direction, since every other
 * point lies on one side of it, so a short step from it toward the midpoint of
 * its two neighbors is reliably interior. The step stops well short of that
 * midpoint: on a low-vertex-count convex shape such as a quad the full midpoint
 * can land at the shape's center, which risks reading as "inside" a smaller
 * shape nested there too (see `findInteriorPoints`). Falls back to the
 * centroid, then to the step point itself, for a non-convex contour where the
 * short step lands outside.
 */
function biasedInteriorPoint(
  contour: Float32Array,
  extreme: 'min' | 'max',
): readonly [number, number] {
  const n = contour.length / 2
  const better = (a: number, b: number): boolean =>
    extreme === 'min' ? a < b : a > b

  let v = 0
  for (let i = 1; i < n; i++) {
    const x = contour[i * 2]
    const y = contour[i * 2 + 1]
    if (
      better(x, contour[v * 2]) ||
      (x === contour[v * 2] && better(y, contour[v * 2 + 1]))
    ) {
      v = i
    }
  }
  const prev = (v - 1 + n) % n
  const next = (v + 1) % n
  const vx = contour[v * 2]
  const vy = contour[v * 2 + 1]
  const midX = (contour[prev * 2] + contour[next * 2]) / 2
  const midY = (contour[prev * 2 + 1] + contour[next * 2 + 1]) / 2
  const NEAR_VERTEX_FRACTION = 0.05
  const nearVertex: readonly [number, number] = [
    vx + NEAR_VERTEX_FRACTION * (midX - vx),
    vy + NEAR_VERTEX_FRACTION * (midY - vy),
  ]

  let cx = 0
  let cy = 0
  for (let i = 0; i < n; i++) {
    cx += contour[i * 2]
    cy += contour[i * 2 + 1]
  }
  const centroid: readonly [number, number] = [cx / n, cy / n]

  for (const p of [nearVertex, centroid]) {
    if (pointInPolygon(p[0], p[1], contour)) return p
  }
  // Pathological non-convex contour where neither candidate lands inside.
  // Used anyway: a wrong interior point degrades nesting classification for
  // this one contour rather than failing the whole triangulation.
  return nearVertex
}

/**
 * Points strictly inside `contour`, for classifying nesting (see
 * `nestContours`). Empty for a degenerate contour of fewer than 3 points.
 *
 * A single interior point, however it is chosen, can coincide with another
 * contour sharing the same vertex, the same center of symmetry, or any other
 * point the choice happens to land on: a hole punched at a shape's exact center
 * reads as "containing" that shape's own near-vertex point too, if that shape
 * is itself small and centered the same way, and a hole that touches its
 * container's boundary at one vertex reads as "containing" a point taken near
 * that same vertex. Taking points from two opposite extreme vertices and
 * requiring every one of a contour's points to land inside another before
 * treating it as contained rules out a false positive from either case, since
 * the two points sit on opposite sides of the shape.
 */
function findInteriorPoints(
  contour: Float32Array,
): readonly (readonly [number, number])[] {
  if (contour.length / 2 < 3) return []
  return [
    biasedInteriorPoint(contour, 'min'),
    biasedInteriorPoint(contour, 'max'),
  ]
}

/**
 * Nest `contours` by the even-odd rule: a contour's depth is how many other
 * contours contain its interior point, even depth is a filled region, odd depth
 * is a hole punched in the nearest (innermost) even-depth region that contains
 * it. Returns one group per even-depth contour, each paired with its direct
 * holes.
 *
 * `O(n * m)` where `m` is a contour's vertex count: a cheap, load-time-only
 * cost for the small contour counts an SVG map produces.
 */
function nestContours(
  contours: readonly Float32Array[],
): { outer: number; holes: number[] }[] {
  const n = contours.length
  const interiorPoints = contours.map(findInteriorPoints)

  // `contains[container][containee]` is whether `container`'s boundary curve
  // encloses EVERY one of `containee`'s interior points, independent of any
  // hole punched into `container` elsewhere. That independence is what lets a
  // hole and the island nested inside it both read as contained by the same
  // outer ring. Requiring every point to agree, rather than just one, is what
  // rules out the false positives `findInteriorPoints` documents.
  const contains: boolean[][] = Array.from({ length: n }, () =>
    new Array<boolean>(n).fill(false),
  )
  for (let containee = 0; containee < n; containee++) {
    const points = interiorPoints[containee]
    if (points.length === 0) continue
    for (let container = 0; container < n; container++) {
      if (container === containee) continue
      if (contours[container].length / 2 < 3) continue
      if (
        points.every((p) => pointInPolygon(p[0], p[1], contours[container]))
      ) {
        contains[container][containee] = true
      }
    }
  }

  const depth = new Array<number>(n).fill(0)
  for (let containee = 0; containee < n; containee++) {
    for (let container = 0; container < n; container++) {
      if (contains[container][containee]) depth[containee]++
    }
  }

  const holesByOuter = new Map<number, number[]>()
  const orphanHoles: number[] = []
  for (let i = 0; i < n; i++) {
    if (depth[i] % 2 === 0) continue
    // The direct parent is the containing contour of even depth closest to
    // `i`, i.e. the one with the greatest depth among even-depth containers.
    let parent = -1
    let parentDepth = -1
    for (let container = 0; container < n; container++) {
      if (
        contains[container][i] &&
        depth[container] % 2 === 0 &&
        depth[container] > parentDepth
      ) {
        parentDepth = depth[container]
        parent = container
      }
    }
    if (parent === -1) {
      orphanHoles.push(i)
      continue
    }
    const holes = holesByOuter.get(parent)
    if (holes) holes.push(i)
    else holesByOuter.set(parent, [i])
  }

  const groups: { outer: number; holes: number[] }[] = []
  for (let i = 0; i < n; i++) {
    if (depth[i] % 2 === 0)
      groups.push({ outer: i, holes: holesByOuter.get(i) ?? [] })
  }
  // A hole with no even-depth container is pathological input (contours that
  // cross, or a lone odd-depth contour from unbalanced nesting). Triangulate
  // it as its own region rather than dropping it.
  for (const i of orphanHoles) groups.push({ outer: i, holes: [] })
  return groups
}

/**
 * Triangulate contours via earcut, nested by the even-odd rule (see
 * `nestContours`): a contour enclosed by an odd number of others is a hole in
 * the nearest even-depth one, not a fill of its own. An enclave (an island
 * fully inside a hole) and a merely adjacent region (mainland plus a coastal
 * island) are told apart by that count, not by winding direction, since SVG
 * exporters do not apply winding consistently.
 *
 * Returns interleaved f32 vertices + uint16 triangle indices. Throws above 65
 * 535 total verts.
 */
export function tessellateContours(contours: Float32Array[]): GeometryHandle {
  if (contours.length === 0) {
    return { vertices: new Float32Array(0), indices: new Uint16Array(0) }
  }
  let totalPoints = 0
  for (const c of contours) totalPoints += c.length / 2
  if (totalPoints > 65_535) {
    throw new Error(
      `tessellateContours: ${totalPoints} vertices exceeds 65535 (Uint16 index limit)`,
    )
  }

  const pointCounts = contours.map((c) => c.length / 2)
  const pointOffsets = new Array<number>(contours.length)
  {
    let cursor = 0
    for (let i = 0; i < contours.length; i++) {
      pointOffsets[i] = cursor
      cursor += pointCounts[i]
    }
  }

  const vertices = new Float32Array(totalPoints * 2)
  let dstFloatCursor = 0
  for (const c of contours) {
    vertices.set(c, dstFloatCursor)
    dstFloatCursor += c.length
  }

  const allIndices: number[] = []
  for (const { outer, holes } of nestContours(contours)) {
    if (pointCounts[outer] < 3) continue
    if (holes.length === 0) {
      // earcut on this contour alone -> offset the returned indices so they
      // reference positions in the merged `vertices` buffer.
      const tris = earcut(Array.from(contours[outer]))
      for (const t of tris) allIndices.push(pointOffsets[outer] + t)
      continue
    }
    // earcut wants one flat coordinate list with the outer ring first and
    // each hole's starting index named in `holeIndices`, so the outer ring
    // and its holes are concatenated into a local buffer, triangulated
    // together, and the result mapped back to the merged `vertices` buffer's
    // global offsets.
    const group = [outer, ...holes]
    const coords: number[] = []
    const holeIndices: number[] = []
    const localToGlobal: number[] = []
    for (const idx of group) {
      if (idx !== outer) holeIndices.push(coords.length / 2)
      for (let k = 0; k < contours[idx].length; k++)
        coords.push(contours[idx][k])
      for (let k = 0; k < pointCounts[idx]; k++)
        localToGlobal.push(pointOffsets[idx] + k)
    }
    const tris = earcut(coords, holeIndices)
    for (const t of tris) allIndices.push(localToGlobal[t])
  }

  const indices = new Uint16Array(allIndices.length)
  for (let j = 0; j < allIndices.length; j++) indices[j] = allIndices[j]
  return { vertices, indices }
}
