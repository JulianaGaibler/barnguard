// Vignette post-effect. Darkens toward the edges by a smooth radial
// falloff. Multiplying a premultiplied pixel by a scalar scales color and alpha
// together, so the result stays a valid premultiplied color.
//
// Shared fullscreen vertex: one oversized clip-space triangle covering the
// viewport. The texture coordinate arrives as a vertex attribute rather than
// being derived from the position, because the two backends disagree on which
// row of a sampled render target is the top: WebGPU stores row 0 at the top and
// WebGL at the bottom (`NdcConventions.textureTopDown`). Deriving uv from the
// clip position would bake one backend's answer into the shader and turn every
// odd-numbered ping-pong pass upside down on the other. `PostProcessPipeline`
// uploads the V-flipped triangle when the device needs it.
//
// Bindings (one bind group): u_tex at unit 0, Params at POST_PARAMS_UBO_BINDING
// (6), a_pos at location 0, a_uv at location 1. Sampler at texture_binding + 16.

struct Params {
  vig: vec4<f32>, // x = intensity (0 off, 1 corners black), y = radius, z = softness
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
  let src = textureSample(u_tex, u_texSamp, in.uv);
  let d = distance(in.uv, vec2<f32>(0.5));
  let v = 1.0 - params.vig.x * smoothstep(params.vig.y, params.vig.y + params.vig.z, d);
  return src * v;
}
