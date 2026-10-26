/**
 * Geometry shared by every map's loader: folding a multi-path SVG into one
 * shape, and turning that shape into the landmass mask.
 */

import {
  buildBitmapMask,
  getPathContours,
  registerPathTessellation,
  tessellateContours,
  type BitmapMask,
  type Rect,
  type SvgPathEntry,
  type SvgPathMap,
  type Vec2,
} from 'stargazer'

/**
 * Merge every path in `map` into a single `Path2D` plus union AABB, carrying
 * the tessellation across so the result renders on GPU. Two callers want this:
 * an outline that ships as mainland plus islands, and a map with no outline
 * asset at all, where the union of its regions _is_ the landmass.
 */
export function mergeAllPaths(map: SvgPathMap): SvgPathEntry | null {
  const merged = new Path2D()
  let bounds: Rect | null = null
  const mergedContours: Float32Array[] = []
  for (const entry of map.paths.values()) {
    merged.addPath(entry.path)
    // Each source path was tessellated by `parseSvgPaths`, so the contours are
    // already pooled and the union just needs retriangulating.
    const partContours = getPathContours(entry.path)
    if (partContours) {
      for (const c of partContours) mergedContours.push(c)
    }
    if (!bounds) {
      bounds = { ...entry.bounds }
    } else {
      const x = Math.min(bounds.x, entry.bounds.x)
      const y = Math.min(bounds.y, entry.bounds.y)
      const right = Math.max(
        bounds.x + bounds.width,
        entry.bounds.x + entry.bounds.width,
      )
      const bottom = Math.max(
        bounds.y + bounds.height,
        entry.bounds.y + entry.bounds.height,
      )
      bounds = { x, y, width: right - x, height: bottom - y }
    }
  }
  if (!bounds) return null
  if (mergedContours.length > 0) {
    const triangles = tessellateContours(mergedContours)
    registerPathTessellation(merged, triangles, mergedContours)
  }
  return { path: merged, bounds }
}

/** Resolution of the landmass mask, per axis. */
const LAND_MASK_RESOLUTION = 1024

/**
 * Rasterize `path` over `worldRect` for O(1) inside tests. Feeds spawn
 * rejection sampling and the grid overlay's cell filter.
 */
export function buildLandMask(
  path: Path2D,
  worldRect: Rect,
): Promise<BitmapMask> {
  return buildBitmapMask({
    path,
    worldRect,
    resolution: LAND_MASK_RESOLUTION,
  })
}

/**
 * Which regions the artwork draws inside another one.
 *
 * Some maps draw an enclosed region twice over: once as part of the shape
 * around it, and once as its own. Both then paint, and with a translucent fill
 * the enclosed region reads brighter than everything else on the map, with a
 * doubled border and doubled inset glows on top.
 *
 * Cutting the enclosed ring out of its container as a hole is the obvious fix
 * and does not work here. The container's outline usually runs along part of
 * the enclosed region's border (an SVG of Serbia including Kosovo traces
 * Kosovo's southwestern border as its own edge), and earcut cannot bridge a
 * hole that touches the outer ring. It silently returns the uncut
 * triangulation, which its own `deviation` metric reports as a large error. So
 * the caller suppresses the enclosed region's fill instead, leaving the
 * container's fill to show through.
 *
 * Containment is tested with the enclosed region's deepest interior point, so a
 * region merely adjacent to another is left alone.
 */
export function findEnclosedRegions(
  shapes: ReadonlyMap<string, { shape: SvgPathEntry; interior: Vec2 }>,
): Set<string> {
  const enclosed = new Set<string>()
  for (const [innerId, inner] of shapes) {
    for (const [outerId, outer] of shapes) {
      if (innerId === outerId) continue
      const contours = outer.shape.contours
      if (!contours || !pointInContours(inner.interior, contours)) continue
      enclosed.add(innerId)
      break
    }
  }
  return enclosed
}

/** Even-odd containment of `pt` across every contour at once. */
function pointInContours(pt: Vec2, contours: readonly Float32Array[]): boolean {
  let hit = false
  for (const poly of contours) {
    const n = poly.length / 2
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const xi = poly[i * 2]
      const yi = poly[i * 2 + 1]
      const xj = poly[j * 2]
      const yj = poly[j * 2 + 1]
      if (
        yi > pt.y !== yj > pt.y &&
        pt.x < ((xj - xi) * (pt.y - yi)) / (yj - yi) + xi
      ) {
        hit = !hit
      }
    }
  }
  return hit
}
