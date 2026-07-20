/**
 * Cached triangulated geometry for a shape. `vertices` is interleaved `[x0, y0,
 * x1, y1, ...]` in the shape's own coordinate space (the Path2D's SVG viewport
 * in the current codebase); `indices` addresses those vertex pairs by index.
 * GpuGfx keeps a `WeakMap<Path2D, GeometryHandle>` so a given `Path2D` is
 * tessellated at most once.
 *
 * ≤ 65 535 vertices per handle (Uint16 addressing); asserted in
 * `SvgPathContours.tessellateContours` at construction time.
 *
 * @category Advanced
 */
export interface GeometryHandle {
  vertices: Float32Array
  indices: Uint16Array
}
