/**
 * SVG path → flattened polylines → triangulated geometry.
 *
 * Three responsibilities, all callable independently:
 *
 * 1. **Load-time flattening**, `flattenSvgPath(d, tol)` turns a `d` attribute
 *    string into an array of contours (interleaved `[x0,y0,x1,y1,…]`
 *    `Float32Array`s). One contour per `M`.
 * 2. **Live Bézier flattening**, `flattenQuadratic` / `flattenCubic` subdivide a
 *    single segment into a caller-owned `Float32Array` with a write cursor.
 *    Zero allocation, safe on the render hot path (called by
 *    `GpuGfx.strokeQuadratic` / `strokePath2D`).
 * 3. **Triangulation**, `tessellateContours(contours)` runs `earcut` and returns a
 *    `GeometryHandle` (`{vertices, indices}`). Bounded to 65 535 verts per
 *    shape (Uint16 addressing); throws on overflow.
 *
 * Curve flatness test = **midpoint deviation from chord** (standard subdivision
 * heuristic). Tolerance is in the same coordinate space as the input; callers
 * translate pixel tolerance ⇄ world units via the current transform's scale
 * before calling.
 */

import earcut from 'earcut'
import type { GeometryHandle } from '../render/gfx/GeometryHandle'
import { tokenizeSvgPath } from './SvgPathMap'

// Cap subdivision depth so pathological curves don't hang. ~13 levels
// covers a 4K screen at 0.5-px tolerance; 16 gives comfortable margin.
const MAX_SUBDIV_DEPTH = 16

// --- Live Bézier flatteners -------------------------------------------------

/**
 * Flatten a quadratic Bézier from `(x0,y0)` through control `(cx,cy)` to
 * `(x1,y1)`. **The starting point `(x0,y0)` is assumed to already be at
 * `out[cursor-2..cursor-1]`** (the previous segment's endpoint or the polyline
 * start); this function appends **only the emitted intermediate points and
 * `(x1,y1)`**. Returns the new cursor (in floats).
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
 * is assumed already present; only intermediate + end points are appended.
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

// --- Path-string flattener --------------------------------------------------

/**
 * Flatten an SVG `d` string into an array of contours. Each contour is a
 * `Float32Array` of interleaved `[x0,y0,x1,y1,…]` points. Closing `Z` emits the
 * closing segment; a fresh `M` starts a new contour.
 *
 * Handles M/L/H/V/C/S/Q/T/A/Z (matches `computePathBounds`'s command set). `A`
 * (arc) is flattened as a straight line to the endpoint, no dynamic SVG in the
 * game uses arcs, but the fallback is safe.
 */
export function flattenSvgPath(d: string, tol: number): Float32Array[] {
  const tokens = tokenizeSvgPath(d)
  const contours: Float32Array[] = []
  // Growable buffer for the current contour; sealed on Z or new M.
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
        // Skip params; treat arc as a line to endpoint (no dynamic node
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

// --- Triangulation ----------------------------------------------------------

/**
 * Triangulate a list of contours via earcut. Each contour is treated as an
 * **independent outer polygon**, never as a hole in a previous one.
 *
 * This differs from earcut's "first outer, rest holes" convention on purpose:
 * the game's map SVGs are multi-REGION (mainland + islands per state), never
 * multi-contour-single-region-with-holes. Real enclaves (Berlin inside
 * Brandenburg, Bremen inside Niedersachsen) live in separate top-level
 * `Path2D`s at the `SvgPathMap` level, not as sub-paths of the enclosing state.
 * Treating sibling contours as holes previously punched Schleswig-Holstein's 12
 * islands (Sylt, Fehmarn, Amrum, Föhr…) out of the mainland fill, producing
 * island-shaped voids.
 *
 * If a Path2D genuinely needs a hole (a lake carved from a filled shape) the
 * caller would need a different tessellator that winding-order-detects hole
 * contours, none of the current game geometry does.
 *
 * Returns a `GeometryHandle` with `vertices` (interleaved f32 pairs) and
 * `indices` (uint16 triangle list) referencing the merged vertex list. Throws
 * if total vertex count exceeds 65 535 (Uint16 index limit).
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
  const vertices = new Float32Array(totalPoints * 2)
  const allIndices: number[] = []
  let dstFloatCursor = 0
  let pointCursor = 0
  for (const c of contours) {
    const pointsInContour = c.length / 2
    if (pointsInContour >= 3) {
      // earcut on this contour alone → offset the returned indices so they
      // reference positions in the merged `vertices` buffer.
      const tris = earcut(Array.from(c))
      for (let j = 0; j < tris.length; j++) {
        allIndices.push(pointCursor + tris[j])
      }
    }
    vertices.set(c, dstFloatCursor)
    dstFloatCursor += c.length
    pointCursor += pointsInContour
  }
  const indices = new Uint16Array(allIndices.length)
  for (let j = 0; j < allIndices.length; j++) indices[j] = allIndices[j]
  return { vertices, indices }
}
