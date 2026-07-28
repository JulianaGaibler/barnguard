// Chromatic-aberration post-effect (WGSL source of truth, GLSL ES 300 generated
// by crates/shader-gen via naga). Splits the RGB channels along a radial offset
// that grows toward the edges (scaled by r² from center), mimicking a lens's
// transverse color error. The frame is premultiplied, so the output alpha is the
// max of the three taps' alphas, which guarantees rgb ≤ a (a valid premultiplied
// state, otherwise the fringe would composite as additive over the page).
//
// Shared fullscreen vertex (see vignette.wgsl). Bindings: u_tex at unit 0,
// Params at POST_PARAMS_UBO_BINDING (6), a_pos at location 0.

struct Params {
  ca: vec4<f32>, // x = amount (peak channel separation in uv units at the corners)
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
  let amount = params.ca.x;
  let centered = in.uv - vec2<f32>(0.5);
  let dir = centered * amount * dot(centered, centered);
  let rC = textureSample(u_tex, u_texSamp, in.uv - dir);
  let gC = textureSample(u_tex, u_texSamp, in.uv);
  let bC = textureSample(u_tex, u_texSamp, in.uv + dir);
  return vec4<f32>(rC.r, gC.g, bC.b, max(rC.a, max(gC.a, bC.a)));
}
