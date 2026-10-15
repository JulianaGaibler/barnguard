// Copy: passes its input through unchanged. It lets a render land in a target
// of its own, such as the one a cached layer keeps, when the layer has no
// effect to produce it.
//
// Shared fullscreen vertex (see vignette.wgsl). Bindings: u_tex at unit 0,
// a_pos at location 0, a_uv at location 1. There is no Params block.

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
  return textureSample(u_tex, u_texSamp, in.uv);
}
