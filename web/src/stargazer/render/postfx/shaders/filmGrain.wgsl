// Film grain: scattered cells of one tint color, each either untouched or
// blended in at `opacity`. `density` is the fraction of cells that carry
// grain. Hashing a cell index rather than a continuous uv is what makes this
// grain instead of a smooth gradient, since a fract-based hash only looks
// random across inputs that differ by roughly 1 or more.
//
// Shared fullscreen vertex (see vignette.wgsl). Bindings: u_tex at unit 0,
// Params at POST_PARAMS_UBO_BINDING (6), a_pos at location 0, a_uv at location 1.

struct Params {
  p0: vec4<f32>,   // (cellPx, density, opacity, frameIndex)
  tint: vec4<f32>, // rgb, w unused
};
@group(0) @binding(6) var<uniform> params: Params;

@group(0) @binding(0) var u_tex: texture_2d<f32>;
@group(0) @binding(16) var u_texSamp: sampler;

struct VOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

@vertex
fn vs_main(
  @location(0) a_pos: vec2<f32>,
  @location(1) a_uv: vec2<f32>,
) -> VOut {
  var out: VOut;
  out.uv = a_uv;
  out.pos = vec4<f32>(a_pos, 0.0, 1.0);
  return out;
}

// The frame counter is the third input rather than an offset onto the cell
// coordinate. Offsetting the coordinate translates the whole field, which
// reads as the grain sliding across the screen instead of re-rolling.
fn hash13(p: vec3<f32>) -> f32 {
  var p3 = fract(p * 0.1031);
  p3 += dot(p3, p3.zyx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
}

@fragment
fn fs_main(in: VOut) -> @location(0) vec4<f32> {
  let color = textureSample(u_tex, u_texSamp, in.uv);

  let cellPx = params.p0.x;
  let density = params.p0.y;
  let opacity = params.p0.z;
  let frameIndex = params.p0.w;

  let cell = floor(in.pos.xy / cellPx);
  let n = hash13(vec3<f32>(cell, frameIndex));
  let grain = step(1.0 - density, n) * opacity;

  // `tint * color.a` keeps the blend premultiplied-valid: an edge pixel's
  // grain fades with its alpha instead of adding opaque color at a
  // transparent edge.
  let tinted = params.tint.rgb * color.a;
  return vec4<f32>(mix(color.rgb, tinted, grain), color.a);
}
