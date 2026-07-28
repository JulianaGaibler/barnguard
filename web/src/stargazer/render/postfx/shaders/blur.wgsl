// Separable-blur post-effect. One axis of a 5-tap Gaussian, run twice
// (horizontal then vertical) by the VignetteBlur effect. The blur step scales
// with radial distance, zero at center (sharp), maximal at the edges, for a
// focus/lens look. `p0.xy` is the per-texel axis (texelW,0) or (0,texelH).
//
// Blurs sRGB-encoded (not light-linear) values, a slight darkening, accepted
// as a cheap stylistic edge blur. The unit-weight sum of premultiplied samples
// keeps the premultiplied color valid.
//
// Shared fullscreen vertex (see vignette.wgsl). Bindings: u_tex at unit 0,
// Params at POST_PARAMS_UBO_BINDING (6), a_pos at location 0.

// Normalized 5-tap Gaussian: 0.375 + 2·0.25 + 2·0.0625 = 1.0 (no brightening).
const W0: f32 = 0.375;
const W1: f32 = 0.25;
const W2: f32 = 0.0625;

struct Params {
  p0: vec4<f32>, // (dirX, dirY, radius, softness)
  p1: vec4<f32>, // x = strength (texels at edge)
};
@group(0) @binding(6) var<uniform> params: Params;

@group(0) @binding(0) var u_tex: texture_2d<f32>;
@group(0) @binding(16) var u_texSamp: sampler;

struct VOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

@vertex
fn vs_main(@location(0) a_pos: vec2<f32>) -> VOut {
  var out: VOut;
  out.uv = a_pos * 0.5 + vec2<f32>(0.5);
  out.pos = vec4<f32>(a_pos, 0.0, 1.0);
  return out;
}

@fragment
fn fs_main(in: VOut) -> @location(0) vec4<f32> {
  let dir = params.p0.xy;
  let radius = params.p0.z;
  let softness = params.p0.w;
  let strength = params.p1.x;
  let d = distance(in.uv, vec2<f32>(0.5));
  let amt = smoothstep(radius, radius + softness, d);
  let off = dir * (strength * amt);
  var sum = textureSample(u_tex, u_texSamp, in.uv) * W0;
  sum = sum + (textureSample(u_tex, u_texSamp, in.uv + off)
             + textureSample(u_tex, u_texSamp, in.uv - off)) * W1;
  sum = sum + (textureSample(u_tex, u_texSamp, in.uv + off * 2.0)
             + textureSample(u_tex, u_texSamp, in.uv - off * 2.0)) * W2;
  return sum;
}
