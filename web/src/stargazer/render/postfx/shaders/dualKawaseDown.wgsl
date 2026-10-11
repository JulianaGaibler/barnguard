// Dual Kawase downsample pass. One level of a blur chain: 5 taps (center +
// 4 diagonal corners) averaged so a flat input stays flat.
//
// Shared fullscreen vertex (see vignette.wgsl). Bindings: u_tex at unit 0,
// Params at POST_PARAMS_UBO_BINDING (6), a_pos at location 0, a_uv at location 1.

struct Params {
  p0: vec4<f32>, // (frameSizeRcp.x, frameSizeRcp.y, offset, unused)
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

@fragment
fn fs_main(in: VOut) -> @location(0) vec4<f32> {
  let o = params.p0.xy * 0.5 * params.p0.z;

  var color = textureSample(u_tex, u_texSamp, in.uv) * 4.0;
  color += textureSample(u_tex, u_texSamp, in.uv + vec2<f32>(-o.x, -o.y));
  color += textureSample(u_tex, u_texSamp, in.uv + vec2<f32>( o.x, -o.y));
  color += textureSample(u_tex, u_texSamp, in.uv + vec2<f32>(-o.x,  o.y));
  color += textureSample(u_tex, u_texSamp, in.uv + vec2<f32>( o.x,  o.y));

  return color / 8.0;
}
