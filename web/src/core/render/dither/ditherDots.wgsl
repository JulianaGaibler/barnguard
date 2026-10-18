// Draws the dither: finds the grid cell of each pixel, reads the cell's average
// color from the cells pass, turns it into ink or paper by the chosen threshold
// pattern, and draws the dot shape inside the cell.
//
// Bindings: the cells at 0, the blue-noise tile at 1 and the error-diffusion
// mask at 2. A pass that uses neither binds a 1x1 stand-in.

// #include "dither.inc.wgsl"
// #include "ditherVertex.inc.wgsl"

@group(0) @binding(0) var u_tex: texture_2d<f32>;
@group(0) @binding(16) var u_texSamp: sampler;
@group(0) @binding(1) var u_tex1: texture_2d<f32>;
@group(0) @binding(17) var u_tex1Samp: sampler;
@group(0) @binding(2) var u_tex2: texture_2d<f32>;
@group(0) @binding(18) var u_tex2Samp: sampler;

fn blueNoiseThreshold(cell: vec2<i32>) -> f32 {
  let side = vec2<i32>(textureDimensions(u_tex1, 0));
  var wrapped = cell;
  if (params.flags.x > 0.5) {
    // A different low-discrepancy offset of the tile each frame.
    let shift = floor(vec2<f32>(side) * fract(vec2<f32>(0.7548777, 0.5698403) * floor(params.cells.w)));
    wrapped = wrapped + vec2<i32>(shift);
  }
  wrapped = ((wrapped % side) + side) % side;
  // The byte's center within its 1/256 step, so no threshold reaches 0 or 1
  // and a cell of pure black or pure white never flips.
  return (textureLoad(u_tex1, wrapped, 0).r * 255.0 + 0.5) / 256.0;
}

fn cellThreshold(cell: vec2<i32>) -> f32 {
  switch (u32(params.modes.x)) {
    case PATTERN_BAYER2: { return bayerThreshold(cell, 1u); }
    case PATTERN_BAYER4: { return bayerThreshold(cell, 2u); }
    case PATTERN_BAYER8: { return bayerThreshold(cell, 3u); }
    case PATTERN_BLUE_NOISE: { return blueNoiseThreshold(cell); }
    case PATTERN_WHITE_NOISE: {
      let reseed = select(0.0, floor(params.cells.w) * 13.37, params.flags.x > 0.5);
      return hash21(vec2<f32>(cell) + vec2<f32>(reseed));
    }
    case PATTERN_INTERLEAVED_GRADIENT: { return interleavedGradientThreshold(cell); }
    default: { return 0.5; }
  }
}

// The color of a quantized cell in the threshold patterns.
fn cellColor(level: f32, threshold: f32, source: vec3<f32>) -> vec4<f32> {
  switch (u32(params.modes.z)) {
    case PALETTE_RAMP: { return rampColor(level); }
    case PALETTE_NEAREST: {
      let nudged = clamp(toneRgb(source) + vec3<f32>((threshold - 0.5) * params.misc.x), vec3<f32>(0.0), vec3<f32>(1.0));
      return nearestPaletteColor(nudged);
    }
    case PALETTE_SOURCE: {
      return vec4<f32>(mix(params.paper.rgb, source, level), mix(params.paper.a, 1.0, level));
    }
    default: { return mix(params.paper, params.ink, level); }
  }
}

// The ink color of the shapes whose size follows the tone.
fn inkColor(source: vec3<f32>) -> vec4<f32> {
  switch (u32(params.modes.z)) {
    case PALETTE_RAMP: { return params.palette[paletteSize() - 1]; }
    case PALETTE_NEAREST: { return nearestPaletteColor(toneRgb(source)); }
    case PALETTE_SOURCE: { return vec4<f32>(source, 1.0); }
    default: { return params.ink; }
  }
}

// How much of the cell the dot covers at `inCell` (0 to 1 across the cell),
// anti-aliased over `softness` pixels.
fn dotCoverage(inCell: vec2<f32>, level: f32) -> f32 {
  let cellPx = params.frame.z;
  let edge = max(params.dot.z, 0.01) / cellPx;
  let fromCenter = inCell - vec2<f32>(0.5);
  switch (u32(params.modes.y)) {
    case DOT_SQUARE_INSET: {
      let halfSide = 0.5 * params.dot.x;
      return 1.0 - smoothstep(halfSide - edge, halfSide + edge, max(abs(fromCenter.x), abs(fromCenter.y)));
    }
    case DOT_CIRCLE: {
      let radius = 0.5 * params.dot.x;
      return 1.0 - smoothstep(radius - edge, radius + edge, length(fromCenter));
    }
    case DOT_CIRCLE_AM: {
      if (level <= 0.0005) { return 0.0; }
      // A cell of area 1 gets ink coverage `level` at radius sqrt(level / pi).
      let radius = max(sqrt(level / PI) * params.dot.x, params.dot.y);
      return 1.0 - smoothstep(radius - edge, radius + edge, length(fromCenter));
    }
    case DOT_SQUARE_AM: {
      if (level <= 0.0005) { return 0.0; }
      let halfSide = max(0.5 * sqrt(level) * params.dot.x, params.dot.y);
      return 1.0 - smoothstep(halfSide - edge, halfSide + edge, max(abs(fromCenter.x), abs(fromCenter.y)));
    }
    default: { return 1.0; }
  }
}

@fragment
fn fs_main(in: VertexOut) -> @location(0) vec4<f32> {
  let cellPx = params.frame.z;
  let fromTop = vec2<f32>(in.position.x, select(params.frame.y - in.position.y, in.position.y, rowsRunTopToBottom()));
  let gridPosition = (fromTop - params.grid.xy) / cellPx;
  let cell = vec2<i32>(floor(gridPosition));
  let inCell = fract(gridPosition);

  let cellCount = vec2<i32>(params.cells.xy);
  let local = cell - vec2<i32>(params.grid.zw);
  let texel = vec2<i32>(clamp(local.x, 0, cellCount.x - 1), cellRow(clamp(local.y, 0, cellCount.y - 1), cellCount.y));
  let average = textureLoad(u_tex, texel, 0);

  if (params.dot.w > 0.0 && average.a < params.dot.w) {
    return vec4<f32>(0.0);
  }
  let source = average.rgb / max(average.a, 1e-4);
  let tone = toneMap(dot(source, LUMA));

  var levels = u32(params.modes.w);
  if (u32(params.modes.z) == PALETTE_RAMP) {
    levels = u32(paletteSize());
  }

  var threshold = 0.5;
  var level = tone;
  if (u32(params.modes.x) == PATTERN_DIFFUSION) {
    let maskCount = vec2<i32>(textureDimensions(u_tex2, 0));
    let maskTexel = vec2<i32>(clamp(local.x, 0, maskCount.x - 1), cellRow(clamp(local.y, 0, maskCount.y - 1), maskCount.y));
    level = textureLoad(u_tex2, maskTexel, 0).r;
  } else {
    threshold = cellThreshold(cell);
    if (levels >= 2u) {
      level = quantize(tone, threshold, levels);
    }
  }

  let shape = u32(params.modes.y);
  var result: vec4<f32>;
  if (shape == DOT_CIRCLE_AM || shape == DOT_SQUARE_AM) {
    result = mix(premultiply(params.paper), premultiply(inkColor(source)), dotCoverage(inCell, level));
  } else {
    let color = premultiply(cellColor(level, threshold, source));
    if (shape == DOT_SQUARE) {
      result = color;
    } else {
      result = mix(premultiply(params.paper), color, dotCoverage(inCell, level));
    }
  }
  return result;
}
