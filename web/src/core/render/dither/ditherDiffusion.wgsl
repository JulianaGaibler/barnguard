// Error diffusion (Floyd-Steinberg or Atkinson) over the cells. Each cell is
// rounded to the nearest level and the rounding error flows into the cells
// after it, so the pattern depends on every cell before it and cannot be one
// pass per pixel.
//
// One workgroup sweeps the grid in diagonal wavefronts. A cell at column x and
// row y is on wavefront x + 2y, and its error sources are all on the four
// wavefronts before it, so the cells of a wavefront run in parallel and a
// barrier separates wavefronts. Each cell gathers the errors of its sources,
// which is the same sum the usual scatter form builds, so the result is the
// same. Only the last five wavefronts' errors are kept, in workgroup memory.
//
// Bindings: the cells at 0, the output mask at 1 (the level in red).

// #include "dither.inc.wgsl"

@group(0) @binding(0) var cells: texture_2d<f32>;
@group(0) @binding(1) var mask: texture_storage_2d<rgba8unorm, write>;

const WORKGROUP_SIZE: i32 = 256;
// Wavefronts whose errors are kept: a cell's farthest source is four back.
const KEPT_WAVEFRONTS: i32 = 5;
// Rows of cells the workgroup memory holds errors for. More are left empty.
const ROW_LIMIT: i32 = 800;

var<workgroup> errors: array<f32, 4000>;

const KERNEL_FLOYD_STEINBERG: u32 = 0u;
const KERNEL_ATKINSON: u32 = 1u;

// The error a cell left behind, or 0 outside the grid.
fn errorAt(column: i32, row: i32, columns: i32, rows: i32) -> f32 {
  if (column < 0 || column >= columns || row < 0 || row >= rows) {
    return 0.0;
  }
  let wavefront = column + 2 * row;
  return errors[(wavefront % KEPT_WAVEFRONTS) * ROW_LIMIT + row];
}

fn incomingError(column: i32, row: i32, columns: i32, rows: i32) -> f32 {
  if (u32(params.flags.y) == KERNEL_ATKINSON) {
    // Six neighbors each pass on an eighth, so a quarter of the error is lost
    // and the highlights stay open.
    return 0.125 * (
      errorAt(column - 1, row, columns, rows) +
      errorAt(column - 2, row, columns, rows) +
      errorAt(column + 1, row - 1, columns, rows) +
      errorAt(column, row - 1, columns, rows) +
      errorAt(column - 1, row - 1, columns, rows) +
      errorAt(column, row - 2, columns, rows)
    );
  }
  return 0.4375 * errorAt(column - 1, row, columns, rows) +
    0.1875 * errorAt(column + 1, row - 1, columns, rows) +
    0.3125 * errorAt(column, row - 1, columns, rows) +
    0.0625 * errorAt(column - 1, row - 1, columns, rows);
}

@compute @workgroup_size(256)
fn cs_main(@builtin(local_invocation_index) lane: u32) {
  let cellCount = vec2<i32>(params.cells.xy);
  let columns = cellCount.x;
  let rows = min(cellCount.y, ROW_LIMIT);

  var levels = u32(params.modes.w);
  if (u32(params.modes.z) == PALETTE_RAMP) {
    levels = u32(paletteSize());
  }
  let steps = f32(max(levels, 2u) - 1u);
  let wavefrontCount = columns + 2 * (rows - 1);

  for (var wavefront = 0; wavefront < wavefrontCount; wavefront++) {
    let firstRow = max(0, (wavefront - (columns - 1) + 1) / 2);
    let lastRow = min(rows - 1, wavefront / 2);
    for (var row = firstRow + i32(lane); row <= lastRow; row += WORKGROUP_SIZE) {
      let column = wavefront - 2 * row;

      let texel = vec2<i32>(column, cellRow(row, cellCount.y));
      let cell = textureLoad(cells, texel, 0);
      var tone = toneMap(dot(cell.rgb / max(cell.a, 1e-4), LUMA));
      if (params.dot.w > 0.0 && cell.a < params.dot.w) {
        tone = 0.0;
      }

      let value = tone + incomingError(column, row, columns, rows);
      let level = clamp(round(clamp(value, -0.5, 1.5) * steps) / steps, 0.0, 1.0);
      errors[(wavefront % KEPT_WAVEFRONTS) * ROW_LIMIT + row] = value - level;
      textureStore(mask, texel, vec4<f32>(level, 0.0, 0.0, 1.0));
    }
    workgroupBarrier();
  }
}
