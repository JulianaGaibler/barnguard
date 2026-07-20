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
): void {
  pathToGeometry.set(path, geometry)
  if (contours) {
    pathToContours.set(path, contours)
    // Align the closed array length with the contours array, anything
    // shorter/absent is treated as `true` by `getContourClosed`.
    pathToContourClosed.set(path, closed ?? contours.map(() => true))
  }
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
 * per-contour flag was registered (matches historical behavior for SVG shape
 * paths).
 */
export function getContourClosed(path: Path2D, i: number): boolean {
  const flags = pathToContourClosed.get(path)
  if (!flags) return true
  return flags[i] ?? true
}
