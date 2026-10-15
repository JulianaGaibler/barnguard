// Masked radial-gradient program. One instanced quad (dst rect in device px)
// textured with a mask silhouette. The gradient is WORLD-FIXED: the fragment
// computes it from the device-space position vs a per-instance center + radius,
// so translating the quad slides the silhouette across a stationary gradient.
//
// Output = (world-fixed radial gradient) × (mask alpha) × instance alpha.
// `u_stops` is the shared ramp atlas `gradientRadial` also samples, row
// `a_rampRow`. `u_mask` is the silhouette (its alpha channel is the mask). The
// atlas is premultiplied, so the trailing multiplies preserve that.
//
// Bindings match batchLayout.ts:
// a_unit/a_dst/a_srcRect/a_grad/a_rampRow at LOC_MASKGRAD_* (0..4), Frame at
// FRAME_UBO_BINDING (0), u_mask at unit 0, u_stops at unit 1.

struct Frame {
  proj: mat3x3<f32>,
  targetH: f32,
  fragYFlip: f32,
};
@group(0) @binding(0) var<uniform> frame: Frame;

// #include "include/clipUniform.inc.wgsl"


@group(1) @binding(0) var u_mask: texture_2d<f32>;
@group(1) @binding(16) var u_maskSamp: sampler;
@group(1) @binding(1) var u_stops: texture_2d<f32>;
@group(1) @binding(17) var u_stopsSamp: sampler;

struct VOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) uv: vec2<f32>,                 // mask UV
  @location(1) worldPos: vec2<f32>,           // device-px position (for gradient)
  @location(2) @interpolate(flat) grad: vec4<f32>, // (centerX, centerY, radius, alpha)
  @location(3) @interpolate(flat) rampRow: f32,
};

@vertex
fn vs_main(
  @location(0) a_unit: vec2<f32>,
  @location(1) a_dst: vec4<f32>,
  @location(2) a_srcRect: vec4<f32>,
  @location(3) a_grad: vec4<f32>,
  @location(4) a_rampRow: f32,
) -> VOut {
  var out: VOut;
  let pos = a_dst.xy + a_dst.zw * a_unit;
  let clip = frame.proj * vec3<f32>(pos, 1.0);
  out.pos = vec4<f32>(clip.xy, 0.0, 1.0);
  out.uv = mix(a_srcRect.xy, a_srcRect.zw, a_unit);
  out.worldPos = pos;
  out.grad = a_grad;
  out.rampRow = a_rampRow;
  return out;
}

@fragment
fn fs_main(in: VOut) -> @location(0) vec4<f32> {
  let maskA = textureSample(u_mask, u_maskSamp, in.uv).a;
  let radius = max(in.grad.z, 1e-4);
  let t = clamp(distance(in.worldPos, in.grad.xy) / radius, 0.0, 1.0);
  // See gradientRadial.wgsl: remap onto texel centers so t = 0 and t = 1 read
  // the first and last atlas texel exactly, instead of a half-texel short.
  let u = t * (255.0 / 256.0) + 0.5 / 256.0;
  // ATLAS_ROWS must match TextureManager.ts.
  let v = (in.rampRow + 0.5) / 64.0;
  let stopColor = textureSample(u_stops, u_stopsSamp, vec2<f32>(u, v));
  return stopColor * (maskA * in.grad.w * clipCoverage(in.pos.xy));
}
