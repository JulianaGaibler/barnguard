// Shared by the dither passes: the params block, the mode constants, the tone
// curve, the threshold patterns and the palette lookups.
// Bindings: params at 6 (see params.ts for the packing order).
//
// The grid is measured in device pixels from `gridOrigin` on the surface, and a
// cell is `cellPx` wide. Rows are counted from the top of the screen. A texture
// the passes share stores its rows from the top on WebGPU and from the bottom
// on WebGL2, so `cellRow` converts between the two orders.

struct DitherParams {
  frame: vec4<f32>,    // x,y = surface size (px)  z = cell size (px)  w = 1 when texture rows run top to bottom
  grid: vec4<f32>,     // x,y = grid origin on the surface (px)  z,w = first cell column and row
  cells: vec4<f32>,    // x,y = cell columns and rows  z = taps per cell side  w = frame counter
  modes: vec4<f32>,    // x = pattern  y = dot shape  z = palette mode  w = levels (0 = continuous)
  flags: vec4<f32>,    // x = 1 to reseed noise every frame  y = diffusion kernel  z = palette size
  tone: vec4<f32>,     // x = gamma  y = contrast  z = brightness  w = 1 to invert
  dot: vec4<f32>,      // x = dot scale  y = smallest dot radius  z = edge softness (px)  w = alpha threshold
  misc: vec4<f32>,     // x = palette spread
  paper: vec4<f32>,    // the color of an empty cell. Alpha 0 leaves the gaps transparent
  ink: vec4<f32>,      // the color of a full cell
  palette: array<vec4<f32>, 16>,
};
@group(0) @binding(6) var<uniform> params: DitherParams;

const PATTERN_BAYER2: u32 = 0u;
const PATTERN_BAYER4: u32 = 1u;
const PATTERN_BAYER8: u32 = 2u;
const PATTERN_BLUE_NOISE: u32 = 3u;
const PATTERN_WHITE_NOISE: u32 = 4u;
const PATTERN_INTERLEAVED_GRADIENT: u32 = 5u;
const PATTERN_DIFFUSION: u32 = 6u;
const PATTERN_NONE: u32 = 7u;

const DOT_SQUARE: u32 = 0u;
const DOT_SQUARE_INSET: u32 = 1u;
const DOT_CIRCLE: u32 = 2u;
const DOT_CIRCLE_AM: u32 = 3u;
const DOT_SQUARE_AM: u32 = 4u;

const PALETTE_MONO: u32 = 0u;
const PALETTE_RAMP: u32 = 1u;
const PALETTE_NEAREST: u32 = 2u;
const PALETTE_SOURCE: u32 = 3u;

const LUMA: vec3<f32> = vec3<f32>(0.2126, 0.7152, 0.0722);
const PI: f32 = 3.14159265;

fn rowsRunTopToBottom() -> bool {
  return params.frame.w > 0.5;
}

// Converts a row between top-to-bottom order and the texture's own order. The
// conversion is its own inverse.
fn cellRow(row: i32, rowCount: i32) -> i32 {
  return select(rowCount - 1 - row, row, rowsRunTopToBottom());
}

fn hash21(point: vec2<f32>) -> f32 {
  var mixed = fract(vec3<f32>(point.xyx) * 0.1031);
  mixed += dot(mixed, mixed.yzx + 33.33);
  return fract((mixed.x + mixed.y) * mixed.z);
}

// Ordered (Bayer) threshold in (0, 1) for a matrix of side 2^bits. Each bit
// pair of the coordinates contributes one base-4 digit, most significant first.
fn bayerThreshold(cell: vec2<i32>, bits: u32) -> f32 {
  let side = 1u << bits;
  let wrapped = vec2<u32>(vec2<i32>(cell.x & i32(side - 1u), cell.y & i32(side - 1u)));
  var rank = 0u;
  for (var bit = 0u; bit < bits; bit++) {
    let xBit = (wrapped.x >> bit) & 1u;
    let yBit = (wrapped.y >> bit) & 1u;
    rank = rank * 4u + ((xBit ^ yBit) << 1u) + yBit;
  }
  return (f32(rank) + 0.5) / f32(side * side);
}

fn interleavedGradientThreshold(cell: vec2<i32>) -> f32 {
  let point = vec2<f32>(cell);
  return fract(52.9829189 * fract(0.06711056 * point.x + 0.00583715 * point.y));
}

// Gamma, contrast and brightness on one channel, then the optional inversion.
fn toneMap(value: f32) -> f32 {
  var tone = pow(max(value, 0.0), params.tone.x);
  tone = (tone - 0.5) * params.tone.y + 0.5 + params.tone.z;
  tone = clamp(tone, 0.0, 1.0);
  if (params.tone.w > 0.5) {
    tone = 1.0 - tone;
  }
  return tone;
}

fn toneRgb(color: vec3<f32>) -> vec3<f32> {
  return vec3<f32>(toneMap(color.r), toneMap(color.g), toneMap(color.b));
}

// Snaps `value` to one of `levels` evenly spaced values. A threshold in (0, 1)
// decides which neighbor wins, which is what makes the result look dithered.
fn quantize(value: f32, threshold: f32, levels: u32) -> f32 {
  let steps = f32(max(levels, 2u) - 1u);
  return clamp(floor(value * steps + threshold), 0.0, steps) / steps;
}

fn paletteSize() -> i32 {
  return clamp(i32(params.flags.z), 1, 16);
}

fn rampColor(level: f32) -> vec4<f32> {
  let last = paletteSize() - 1;
  return params.palette[clamp(i32(round(level * f32(last))), 0, 15)];
}

fn nearestPaletteColor(color: vec3<f32>) -> vec4<f32> {
  var best = params.palette[0];
  var bestDistance = 1e9;
  for (var index = 0; index < paletteSize(); index++) {
    let candidate = params.palette[index];
    let offset = color - candidate.rgb;
    let squaredDistance = dot(offset, offset);
    if (squaredDistance < bestDistance) {
      bestDistance = squaredDistance;
      best = candidate;
    }
  }
  return best;
}

// A color with its alpha folded in, as the engine's targets hold it.
fn premultiply(color: vec4<f32>) -> vec4<f32> {
  return vec4<f32>(color.rgb * color.a, color.a);
}
