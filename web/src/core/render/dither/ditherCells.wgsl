// Reduces the surface to one texel per grid cell: the average color of the
// pixels the cell covers. The dots pass reads a cell's color from here instead
// of averaging again for every pixel of the cell.
//
// Bindings: the surface at 0.

// #include "dither.inc.wgsl"
// #include "ditherVertex.inc.wgsl"

@group(0) @binding(0) var u_tex: texture_2d<f32>;
@group(0) @binding(16) var u_texSamp: sampler;

@fragment
fn fs_main(in: VertexOut) -> @location(0) vec4<f32> {
  let cellCount = vec2<i32>(params.cells.xy);
  let column = i32(floor(in.position.x));
  let row = cellRow(i32(floor(in.position.y)), cellCount.y);
  let cell = params.grid.zw + vec2<f32>(f32(column), f32(row));
  let cellCorner = params.grid.xy + cell * params.frame.z;

  // Each bilinear tap already blends 2x2 pixels, so a tap every two pixels
  // covers the whole cell.
  let taps = i32(params.cells.z);
  let tapSpacing = params.frame.z / f32(taps);
  var sum = vec4<f32>(0.0);
  for (var tapRow = 0; tapRow < taps; tapRow++) {
    for (var tapColumn = 0; tapColumn < taps; tapColumn++) {
      let point = cellCorner + (vec2<f32>(f32(tapColumn), f32(tapRow)) + 0.5) * tapSpacing;
      let fromTop = point / params.frame.xy;
      let uv = vec2<f32>(fromTop.x, select(1.0 - fromTop.y, fromTop.y, rowsRunTopToBottom()));
      sum += textureSampleLevel(u_tex, u_texSamp, uv, 0.0);
    }
  }
  return sum / f32(taps * taps);
}
