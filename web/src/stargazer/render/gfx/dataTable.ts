/**
 * Geometry of a {@link DataTable} on a backend that stores it as a texture.
 *
 * @remarks
 *   For engine developers: a data table is an array of `vec4<f32>` that a vertex
 *   shader reads by index. WebGPU keeps it in a read-only storage buffer.
 *   WebGL2 has no storage buffers, so it keeps the same array in an `RGBA32F`
 *   texture, {@link DATA_TABLE_WIDTH} texels wide, and the shader fetches
 *   element `i` at texel `(i % WIDTH, i / WIDTH)`. Both backends share this
 *   layout so the generated GLSL and the WGSL read the same indices.
 */
export const DATA_TABLE_WIDTH = 1024

/** A rectangle of texels that one upload writes. */
export interface DataTableSpan {
  x: number
  y: number
  width: number
  height: number
  /** Index of the first `vec4` of this span within the uploaded range. */
  first: number
}

/** Rows needed to hold `vec4Count` elements. */
export function dataTableRows(vec4Count: number): number {
  return Math.max(1, Math.ceil(vec4Count / DATA_TABLE_WIDTH))
}

/**
 * The texel rectangles that cover elements `[first, first + count)`: a partial
 * first row, the full rows in between, and a partial last row. A range inside
 * one row is a single span.
 */
export function dataTableSpans(first: number, count: number): DataTableSpan[] {
  const spans: DataTableSpan[] = []
  let at = first
  const end = first + count
  while (at < end) {
    const x = at % DATA_TABLE_WIDTH
    const y = Math.floor(at / DATA_TABLE_WIDTH)
    if (x === 0 && end - at >= DATA_TABLE_WIDTH) {
      const rows = Math.floor((end - at) / DATA_TABLE_WIDTH)
      spans.push({
        x: 0,
        y,
        width: DATA_TABLE_WIDTH,
        height: rows,
        first: at - first,
      })
      at += rows * DATA_TABLE_WIDTH
    } else {
      const width = Math.min(DATA_TABLE_WIDTH - x, end - at)
      spans.push({ x, y, width, height: 1, first: at - first })
      at += width
    }
  }
  return spans
}
