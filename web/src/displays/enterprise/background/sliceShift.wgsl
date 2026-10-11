// Column displacement ("slice shift"): slices the image into bars along a
// rotated axis and shifts each bar along that axis in proportion to its
// distance from the center. Ported from the brand's Figma shader, with the
// `softness` cross-fade and the per-slice `random` offset dropped (both
// default to 0 in Figma, which already collapses the original to this
// single-sample path).
//
// The rotation matrices are rebuilt from `cosA`/`sinA` per pixel instead of
// stored as a `mat2x2` in the params block, since a `mat2x2<f32>` is 16 bytes
// under WGSL uniform rules but 32 under the std140 layout the generated GLSL
// block uses, a mismatch the WGSL-first std140 contract can't express.
//
// Out-of-range samples wrap (`fract`), matching the Figma original: at a
// large shift, columns far from the center wrap the source more than once.
//
// Shared fullscreen vertex (see stargazer's vignette.wgsl). Bindings: u_tex
// at unit 0, Params at POST_PARAMS_UBO_BINDING (6), a_pos at location 0,
// a_uv at location 1.

struct Params {
  p0: vec4<f32>, // (cosA, sinA, width, height)
  p1: vec4<f32>, // (centerXPercent, centerYPercent, barWidth, shift)
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
  let dims = max(params.p0.zw, vec2<f32>(1.0));
  let cosA = params.p0.x;
  let sinA = params.p0.y;
  let forward = mat2x2<f32>(cosA, sinA, -sinA, cosA);
  let inverse = mat2x2<f32>(cosA, -sinA, sinA, cosA);

  let localCenter = params.p1.xy * 0.01 * dims;
  let barWidth = params.p1.z;
  let shift = params.p1.w;

  var p = forward * (in.uv * dims - localCenter);

  let sliceIndex = floor(p.x / barWidth + 0.5);
  p.x -= sliceIndex * barWidth * shift;

  let targetUv = (inverse * p + localCenter) / dims;
  return textureSample(u_tex, u_texSamp, fract(targetUv));
}
