// Outset path-shadow composite: an instanced affine quad sampling a cached
// blurred-coverage mask (see `PathShadowCache`), tinted by the shadow's own
// color and knocked out of the shape's own silhouette. Registered as an
// ordinary `GpuProgram` (its draws share the screen target and the frame's
// analytic clip, same as `textQuad`), not a private pipeline, since it must
// re-warm alongside every other 2D program when the target's format changes.
//
// Bindings match batchLayout.ts: a_unit/a_mCol0/a_mCol1/a_mTranslate/
// a_srcRect/a_tint/a_dither at LOC_PATHSHADOW_* (0..6), Frame at
// FRAME_UBO_BINDING (0), u_mask at group 1 binding 0.

struct Frame {
  proj: mat3x3<f32>,
  targetH: f32,
  fragYFlip: f32,
};
@group(0) @binding(0) var<uniform> frame: Frame;

// #include "include/clipUniform.inc.wgsl"


// 8x8 ordered (Bayer) dither. See `coloredTri.wgsl` for the full rationale;
// kept in sync by hand (WGSL has no include).
const BAYER8 = array<f32, 64>(
   0.0, 32.0,  8.0, 40.0,  2.0, 34.0, 10.0, 42.0,
  48.0, 16.0, 56.0, 24.0, 50.0, 18.0, 58.0, 26.0,
  12.0, 44.0,  4.0, 36.0, 14.0, 46.0,  6.0, 38.0,
  60.0, 28.0, 52.0, 20.0, 62.0, 30.0, 54.0, 22.0,
   3.0, 35.0, 11.0, 43.0,  1.0, 33.0,  9.0, 41.0,
  51.0, 19.0, 59.0, 27.0, 49.0, 17.0, 57.0, 25.0,
  15.0, 47.0,  7.0, 39.0, 13.0, 45.0,  5.0, 37.0,
  63.0, 31.0, 55.0, 23.0, 61.0, 29.0, 53.0, 21.0,
);
fn bayerValue(fragPos: vec2<f32>) -> f32 {
  let xy = vec2<i32>(fragPos) & vec2<i32>(7, 7);
  return BAYER8[xy.y * 8 + xy.x] / 64.0;
}

@group(1) @binding(0) var u_mask: texture_2d<f32>;
@group(1) @binding(16) var u_maskSamp: sampler;

struct VOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) uv: vec2<f32>,
  @location(1) tint: vec4<f32>,
  @location(2) @interpolate(flat) dither: f32,
};

@vertex
fn vs_main(
  @location(0) a_unit: vec2<f32>,
  @location(1) a_mCol0: vec2<f32>,
  @location(2) a_mCol1: vec2<f32>,
  @location(3) a_mTranslate: vec2<f32>,
  @location(4) a_srcRect: vec4<f32>,
  @location(5) a_tint: vec4<f32>,
  @location(6) a_dither: f32,
) -> VOut {
  var out: VOut;
  let pos = a_mCol0 * a_unit.x + a_mCol1 * a_unit.y + a_mTranslate;
  let clip = frame.proj * vec3<f32>(pos, 1.0);
  out.pos = vec4<f32>(clip.xy, 0.0, 1.0);
  out.uv = mix(a_srcRect.xy, a_srcRect.zw, a_unit);
  out.tint = a_tint;
  out.dither = a_dither;
  return out;
}

@fragment
fn fs_main(in: VOut) -> @location(0) vec4<f32> {
  let m = textureSample(u_mask, u_maskSamp, in.uv);
  // Outset knockout: CSS says the shadow is not painted inside the
  // border-box. R is the blurred coverage, G is the unblurred silhouette.
  let coverage = m.r * (1.0 - m.g);
  var c = in.tint * coverage;
  if (in.dither > 0.5) {
    // Sub-LSB: see `coloredTri.wgsl`'s dither branch for why this is clamped
    // to `c.a` rather than added flat.
    let noise = ((bayerValue(in.pos.xy) - 0.5) / 256.0) * c.a;
    c = vec4<f32>(min(c.rgb + noise, vec3<f32>(c.a)), c.a);
  }
  return c * clipCoverage(in.pos.xy);
}
