// Instanced text-quad program: the sole single-texture affine-quad draw,
// backing both labels (`fillText`) and images (`drawImage`). Per-instance
// placement is a full 2×3 affine (two column vectors + a translation) mapping
// the unit quad to device px, so a draw honors rotation/skew from the node
// transform. The fragment stage samples the texture and multiplies by the
// premultiplied per-instance tint.
//
// Bindings match batchLayout.ts: a_unit/a_mCol0/a_mCol1/a_mTranslate/a_srcRect/
// a_tint at LOC_TEXT_* (0..5), Frame at FRAME_UBO_BINDING (0), u_tex at unit 0.

struct Frame {
  proj: mat3x3<f32>,
  targetH: f32,
  fragYFlip: f32,
};
@group(0) @binding(0) var<uniform> frame: Frame;

struct Clip {
  kind: f32,
  cx: f32,
  cy: f32,
  r: f32,
  halfW: f32,
  halfH: f32,
  rrRadius: f32,
  clipPad: f32,
};
@group(0) @binding(8) var<uniform> clipShape: Clip;

// Analytic clip coverage in device px; frame.fragYFlip corrects WebGL2's
// bottom-up gl_FragCoord. Multiply the premultiplied fragment output by this.
fn clipRoundBox(p: vec2<f32>, b: vec2<f32>, rad: f32) -> f32 {
  let q = abs(p) - b + vec2<f32>(rad);
  return min(max(q.x, q.y), 0.0) + length(max(q, vec2<f32>(0.0))) - rad;
}
fn clipCoverage(fragPos: vec2<f32>) -> f32 {
  if (clipShape.kind < 0.5) { return 1.0; }
  let fy = select(fragPos.y, frame.targetH - fragPos.y, frame.fragYFlip > 0.5);
  let p = vec2<f32>(fragPos.x, fy) - vec2<f32>(clipShape.cx, clipShape.cy);
  var d: f32;
  if (clipShape.kind < 1.5) {
    d = length(p) - clipShape.r;
  } else {
    d = clipRoundBox(p, vec2<f32>(clipShape.halfW, clipShape.halfH), clipShape.rrRadius);
  }
  return clamp(0.5 - d / max(fwidth(d), 1e-4), 0.0, 1.0);
}

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
  return textureSample(u_tex, u_texSamp, in.uv) * in.tint * clipCoverage(in.pos.xy);
}
