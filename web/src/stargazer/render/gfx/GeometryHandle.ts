import type { VBuffer, IBuffer } from './GfxDevice'

/**
 * Cached triangulated geometry for a shape. `vertices` is interleaved `[x0, y0,
 * x1, y1, ...]` in the shape's own coordinate space (the Path2D's SVG viewport
 * in the current codebase). `indices` addresses those vertex pairs by index.
 * GpuGfx keeps a `WeakMap<Path2D, GeometryHandle>` so a given `Path2D` is
 * tessellated at most once.
 *
 * ≤ 65 535 vertices per handle (Uint16 addressing), asserted in
 * `SvgPathContours.tessellateContours` at construction time.
 */
export interface GeometryHandle {
  vertices: Float32Array
  indices: Uint16Array
  /**
   * Keep this geometry in GPU buffers from its first draw and draw it with a
   * model matrix, instead of transforming every vertex on the CPU each frame.
   * Without it, a gradient or masked fill is kept once it is drawn on two
   * frames running. The renderer may still free kept geometry it has not drawn
   * for a while, and uploads it again when it is next drawn. Set at
   * registration, see `registerPathTessellation`.
   */
  retained?: boolean
}

/**
 * A `GeometryHandle`'s GPU residency: its own static vertex + index buffers.
 * Created on the first retained fill and reused every frame after. An indexed
 * draw against them reuses that upload.
 */
export interface GpuGeometry {
  vbo: VBuffer
  ibo: IBuffer
  indexCount: number
  /** The tessellation's local bounding box. */
  minX: number
  minY: number
  maxX: number
  maxY: number
}
