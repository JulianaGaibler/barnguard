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

const pathToEpoch = new WeakMap<Path2D, number>()

/**
 * Index count at or above which a tessellation is kept on the GPU from its
 * first draw, unless `opts.retained` says otherwise. Smaller geometry is kept
 * only once it repeats in a draw that is a run of its own.
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

/**
 * Bumped on every `registerPathTessellation` call for `path`. Part of the
 * outline cache key.
 */
export function getRegistrationEpoch(path: Path2D): number {
  return pathToEpoch.get(path) ?? 0
}

/**
 * Drop a path's registration. Buffers the renderer kept for its geometry are
 * freed once they go undrawn for a while.
 */
export function releasePathTessellation(path: Path2D): void {
  pathToGeometry.delete(path)
  pathToContours.delete(path)
  pathToContourClosed.delete(path)
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
