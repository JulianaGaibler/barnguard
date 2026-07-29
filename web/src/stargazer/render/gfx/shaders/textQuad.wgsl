// Instanced text-quad program. Like texturedQuad, but per-instance placement is
// a full 2×3 affine (two column vectors + a translation) mapping the unit quad
// to device px, so labels honor rotation/skew from the node transform
// (texturedQuad only carries an axis-aligned rect). The fragment stage is the
// same texture × premultiplied tint as texturedQuad.
//
// Bindings match batchLayout.ts: a_unit/a_mCol0/a_mCol1/a_mTranslate/a_srcRect/
// a_tint at LOC_TEXT_* (0..5), Frame at FRAME_UBO_BINDING (0), u_tex at unit 0.

struct Frame {
  proj: mat3x3<f32>,
};
@group(0) @binding(0) var<uniform> frame: Frame;

@group(1) @binding(0) var u_tex: texture_2d<f32>;
@group(1) @binding(16) var u_texSamp: sampler;

struct VOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) uv: vec2<f32>,
  @location(1) tint: vec4<f32>,
};

@vertex
fn vs_main(
  @location(0) a_unit: vec2<f32>,
  @location(1) a_mCol0: vec2<f32>,
  @location(2) a_mCol1: vec2<f32>,
  @location(3) a_mTranslate: vec2<f32>,
  @location(4) a_srcRect: vec4<f32>,
  @location(5) a_tint: vec4<f32>,
) -> VOut {
  var out: VOut;
  let pos = a_mCol0 * a_unit.x + a_mCol1 * a_unit.y + a_mTranslate;
  let clip = frame.proj * vec3<f32>(pos, 1.0);
  out.pos = vec4<f32>(clip.xy, 0.0, 1.0);
  out.uv = mix(a_srcRect.xy, a_srcRect.zw, a_unit);
  out.tint = a_tint;
  return out;
}

@fragment
fn fs_main(in: VOut) -> @location(0) vec4<f32> {
  return textureSample(u_tex, u_texSamp, in.uv) * in.tint;
}
