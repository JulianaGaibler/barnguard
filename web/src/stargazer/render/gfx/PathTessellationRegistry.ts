/**
 * Global registry mapping `Path2D` instances to their tessellated geometry
 * (triangles + contours). Populated by `SvgPathMap.parseSvgPaths` when
 * `tessellate: true` and readable by `GpuGfx` at fill/stroke time.
 *
 * Kept in a separate module (rather than as private state on `GpuGfx`) so asset
 * loaders, which don't hold a `GpuGfx` reference, can register tessellations
 * directly, and every `GpuGfx` instance sees the same registration.
 *
 * Uses `WeakMap` so entries GC away with the `Path2D`, no explicit cleanup
 * required when nodes tear down.
 */

import type { GeometryHandle } from './GeometryHandle'
import type { StrokeOutlineBuffer } from './strokeOutline'

/**
 * Per-path LRU of tessellated stroke outlines (one per distinct style +
 * scale bucket), bounded per path rather than globally: a `WeakMap` cannot be
 * iterated, so a global budget has nothing to sweep. The number of live
 * registered paths is already bounded by the app.
 */
export const OUTLINE_VARIANTS_PER_PATH = 8

const pathToOutlines = new WeakMap<Path2D, Map<string, StrokeOutlineBuffer>>()
const pathToEpoch = new WeakMap<Path2D, number>()

/**
 * Index-count at or above which a tessellation auto-opts into the retained GPU
 * path (upload once, GPU-transform) unless `opts.retained` says otherwise. Big,
 * long-lived geometry (the SVG map, ~15K indices) crosses it. Small one-off
 * shapes (packet glyphs, single contours) stay streamed so churning them can't
 * strand GPU buffers.
 */
const RETAIN_INDEX_THRESHOLD = 1500

const pathToGeometry = new WeakMap<Path2D, GeometryHandle>()
const pathToContours = new WeakMap<Path2D, Float32Array[]>()
const pathToContourClosed = new WeakMap<Path2D, boolean[]>()

/**
 * Register (or replace) a Path2D's tessellation + optional contours.
 *
 * `closed` is a per-contour flag telling the stroke path whether the last
 * segment loops back to the first point. Defaults to `true` for every contour,
 * matches SVG shape paths (states, hexes) whose contours end with a `Z`. Set
 * explicit `false` for open curves like the tutorial arch, otherwise
 * `strokePath2D` will emit a spurious closing segment.
 */
export function registerPathTessellation(
  path: Path2D,
  geometry: GeometryHandle,
  contours?: Float32Array[],
  closed?: boolean[],
  opts?: { retained?: boolean },
): void {
  // Explicit flag wins. Otherwise auto-retain only clearly-large geometry.
  geometry.retained =
    opts?.retained ?? geometry.indices.length >= RETAIN_INDEX_THRESHOLD
  pathToGeometry.set(path, geometry)
  if (contours) {
    pathToContours.set(path, contours)
    // Align the closed array length with the contours array, anything
    // shorter/absent is treated as `true` by `getContourClosed`.
    pathToContourClosed.set(path, closed ?? contours.map(() => true))
  }
  // Re-registering the same Path2D object (a re-parse at a new tolerance)
  // must invalidate any cached stroke outline built from the old contours.
  // `strokePath2D` re-walks `getPathContours` every frame, so without this
  // an outline cache would be the one place that stays staler than the
  // registration.
  pathToEpoch.set(path, (pathToEpoch.get(path) ?? 0) + 1)
}

/** Bumped on every `registerPathTessellation` call for `path`. Part of the outline cache key. */
export function getRegistrationEpoch(path: Path2D): number {
  return pathToEpoch.get(path) ?? 0
}

/**
 * Look up a cached stroke outline for `path` by exact key (style signature +
 * scale bucket + registration epoch, built by the caller), or `undefined` on
 * a miss.
 */
export function getCachedOutline(
  path: Path2D,
  key: string,
): StrokeOutlineBuffer | undefined {
  return pathToOutlines.get(path)?.get(key)
}

/**
 * Cache `outline` for `path` under `key`. Evicts the oldest entry (insertion
 * order) past {@link OUTLINE_VARIANTS_PER_PATH}, per path rather than
 * globally.
 */
export function setCachedOutline(
  path: Path2D,
  key: string,
  outline: StrokeOutlineBuffer,
): void {
  let byKey = pathToOutlines.get(path)
  if (!byKey) {
    byKey = new Map()
    pathToOutlines.set(path, byKey)
  }
  byKey.set(key, outline)
  if (byKey.size > OUTLINE_VARIANTS_PER_PATH) {
    const oldest = byKey.keys().next().value as string | undefined
    if (oldest !== undefined) byKey.delete(oldest)
  }
}

/**
 * Drop a path's registration. Callers holding GPU-resident geometry
 * (`GeometryHandle.gpu`) must release the GPU buffers separately (via
 * `GpuGfx`), since this registry has no device handle. Use from teardown of a
 * node that registered a one-off retained path so its arena can't grow
 * unbounded as games churn.
 */
export function releasePathTessellation(path: Path2D): void {
  pathToGeometry.delete(path)
  pathToContours.delete(path)
  pathToContourClosed.delete(path)
  pathToOutlines.delete(path)
  pathToEpoch.delete(path)
}

/** Fetch the triangulated geometry, or `undefined` if the path isn't registered. */
export function getPathTessellation(path: Path2D): GeometryHandle | undefined {
  return pathToGeometry.get(path)
}

/** Fetch the flattened contours, or `undefined` if the path isn't registered. */
export function getPathContours(path: Path2D): Float32Array[] | undefined {
  return pathToContours.get(path)
}

/**
 * Return whether contour `i` of `path` is closed. Defaults to `true` when no
 * per-contour flag was registered, matching SVG shape paths, whose contours end
 * with a `Z`.
 */
export function getContourClosed(path: Path2D, i: number): boolean {
  const flags = pathToContourClosed.get(path)
  if (!flags) return true
  return flags[i] ?? true
}
