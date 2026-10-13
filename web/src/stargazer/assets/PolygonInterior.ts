/**
 * Measures of a polygon region's interior, for placing and sizing what gets
 * drawn on a shape whose bounding box says little about it. A concave or
 * multi-part outline (a crescent, a country with offshore islands) puts its
 * centroid outside the fill and fills a small fraction of its own bounds, so
 * both a marker anchored at the centroid and a radius taken from the bounds
 * miss the shape they were meant for.
 */

import type { SvgPathEntry } from './SvgPathMap'

/** A contour as flat `[x0, y0, x1, y1, …]`, the shape `flattenSvgPath` emits. */
export type Contour = Float32Array

/**
 * Squared distance from `(x, y)` to the segment `a`-`b`. Squared, so the caller
 * can compare candidates without a square root per segment.
 */
function distSqToSegment(
  x: number,
  y: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax
  const dy = by - ay
  const lenSq = dx * dx + dy * dy
  let t = 0
  if (lenSq > 0) {
    t = ((x - ax) * dx + (y - ay) * dy) / lenSq
    t = t < 0 ? 0 : t > 1 ? 1 : t
  }
  const px = ax + t * dx - x
  const py = ay + t * dy - y
  return px * px + py * py
}

/** Squared distance from `(x, y)` to the nearest edge of any contour. */
function distSqToEdges(
  x: number,
  y: number,
  contours: readonly Contour[],
): number {
  let best = Infinity
  for (const c of contours) {
    const n = c.length / 2
    if (n < 2) continue
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const d = distSqToSegment(
        x,
        y,
        c[j * 2],
        c[j * 2 + 1],
        c[i * 2],
        c[i * 2 + 1],
      )
      if (d < best) best = d
    }
  }
  return best
}

/**
 * Even-odd containment across every contour at once, so a point in a hole reads
 * as outside. Matches `tessellateContours`'s fill rule, which is what makes a
 * marker placed here land on painted pixels.
 */
function insideRegion(
  x: number,
  y: number,
  contours: readonly Contour[],
): boolean {
  let inside = false
  for (const c of contours) {
    const n = c.length / 2
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const xi = c[i * 2]
      const yi = c[i * 2 + 1]
      const xj = c[j * 2]
      const yj = c[j * 2 + 1]
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
        inside = !inside
      }
    }
  }
  return inside
}

/** Samples per axis in each search round. */
const GRID = 16
/** Search rounds, each one re-gridding the best cell of the previous. */
const ROUNDS = 5

/**
 * The point inside `contours` that is furthest from every edge, known as the
 * pole of inaccessibility. Approximated by a grid search that re-grids around
 * its own best sample, so the result is within roughly `extent / GRID **
 * ROUNDS` of the true pole, which is far finer than any use for it needs.
 *
 * Returns `null` when `contours` is empty or encloses no area, since a shape
 * thinner than the first round's grid step has no sample to score.
 *
 * @example
 *   // Anchor a marker that must sit on the shape, not near it.
 *   const at = deepestInteriorPoint(contoursOf(norway))
 *   if (at) marker.transform.setPosition(at[0], at[1])
 */
export function deepestInteriorPoint(
  contours: readonly Contour[],
): readonly [number, number] | null {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const c of contours) {
    for (let i = 0; i < c.length; i += 2) {
      if (c[i] < minX) minX = c[i]
      if (c[i] > maxX) maxX = c[i]
      if (c[i + 1] < minY) minY = c[i + 1]
      if (c[i + 1] > maxY) maxY = c[i + 1]
    }
  }
  if (!(maxX > minX) || !(maxY > minY)) return null

  let bestX = 0
  let bestY = 0
  let bestDistSq = -1
  let x0 = minX
  let y0 = minY
  let x1 = maxX
  let y1 = maxY

  for (let round = 0; round < ROUNDS; round++) {
    const stepX = (x1 - x0) / (GRID + 1)
    const stepY = (y1 - y0) / (GRID + 1)
    for (let gx = 1; gx <= GRID; gx++) {
      const x = x0 + gx * stepX
      for (let gy = 1; gy <= GRID; gy++) {
        const y = y0 + gy * stepY
        if (!insideRegion(x, y, contours)) continue
        const d = distSqToEdges(x, y, contours)
        if (d > bestDistSq) {
          bestDistSq = d
          bestX = x
          bestY = y
        }
      }
    }
    if (bestDistSq < 0) return null
    // Re-grid one cell either side of the winner. Keeping a cell's worth of
    // margin means the true pole stays in the window even when it sits just
    // past the sample that won this round.
    x0 = bestX - stepX
    x1 = bestX + stepX
    y0 = bestY - stepY
    y1 = bestY + stepY
  }
  return [bestX, bestY]
}

/**
 * Mean width of the band `entry` fills, as `2 * area / perimeter`. A long
 * ribbon reports its own width, a disc its radius, and a scattering of islands
 * the width of a typical one, where the bounding box of each of those says
 * something closer to its length.
 *
 * This is the measure an inset rim effect wants. A rim of radius `r` along a
 * perimeter `P` adds light in proportion to `r * P`, spread over an area `A`,
 * so a radius that keeps `r / (A / P)` fixed paints every shape the same mean
 * brightness, whatever its size or how broken up it is. Taking the radius from
 * the bounding box instead floods a thin shape (where the box is mostly not the
 * shape) and under-draws a compact one.
 *
 * Area comes from the tessellation, so a hole counts as the hole it is rather
 * than as more area, and no winding convention is assumed. Returns `0` for an
 * entry parsed without `tessellate: true`, which has neither the triangles nor
 * the contours this reads.
 *
 * @example
 *   // An inset glow that reads as a rim on every shape in the set.
 *   const blur = Math.min(MAX_BLUR, 0.5 * interiorThickness(entry))
 */
export function interiorThickness(entry: SvgPathEntry): number {
  const geo = entry.triangles
  const contours = entry.contours
  if (!geo || !contours) return 0

  let doubleArea = 0
  const v = geo.vertices
  for (let i = 0; i < geo.indices.length; i += 3) {
    const a = geo.indices[i] * 2
    const b = geo.indices[i + 1] * 2
    const c = geo.indices[i + 2] * 2
    doubleArea += Math.abs(
      (v[b] - v[a]) * (v[c + 1] - v[a + 1]) -
        (v[c] - v[a]) * (v[b + 1] - v[a + 1]),
    )
  }

  let perimeter = 0
  for (const contour of contours) {
    const n = contour.length / 2
    for (let i = 0, j = n - 1; i < n; j = i++) {
      perimeter += Math.hypot(
        contour[i * 2] - contour[j * 2],
        contour[i * 2 + 1] - contour[j * 2 + 1],
      )
    }
  }
  return perimeter > 0 ? doubleArea / perimeter : 0
}
