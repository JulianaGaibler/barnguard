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
import type { VBuffer, IBuffer, Vao } from './GfxDevice'

export interface GeometryHandle {
  vertices: Float32Array
  indices: Uint16Array
  /**
   * Opt-in: upload this geometry to static GPU buffers once and draw it with a
   * per-frame model matrix (`fillPath2D` records a retained run) instead of
   * CPU-transforming every vertex every frame. Set at registration for large,
   * long-lived tessellations (the SVG map). See `registerPathTessellation`.
   */
  retained?: boolean
  /**
   * GPU-resident descriptor, populated lazily on the first retained draw and
   * cleared on context loss. Absent until then, or entirely when `retained` is
   * false.
   */
  gpu?: GpuGeometry
}

/**
 * A `GeometryHandle`'s GPU residency: its own static vertex + index buffers and
 * the VAO binding them. Created by `GpuGfx` on the first retained fill and
 * reused every frame after; `drawElements(indexCount, 0)` draws it.
 */
export interface GpuGeometry {
  vbo: VBuffer
  ibo: IBuffer
  vao: Vao
  indexCount: number
}
