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
} from '@src/stargazer'

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
