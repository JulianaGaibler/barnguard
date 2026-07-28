// Instanced textured-quad program (WGSL source of truth, GLSL ES 300 generated
// by crates/shader-gen via naga). One unit-quad template (a_unit ∈ [0,1]²) plus
// a per-instance record: dst rect in device px, src rect in UV space, tint in
// premultiplied 0..1 RGBA. Both texels and tint are premultiplied, so the
// multiply preserves that invariant.
//
// Bindings match batchLayout.ts: a_unit/a_dst/a_srcRect/a_tint at
// LOC_TEXTURED_* (0/1/2/3), Frame at FRAME_UBO_BINDING (0), u_tex at unit 0.

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
  @location(1) a_dst: vec4<f32>,
  @location(2) a_srcRect: vec4<f32>,
  @location(3) a_tint: vec4<f32>,
) -> VOut {
  var out: VOut;
  let pos = a_dst.xy + a_dst.zw * a_unit;
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
