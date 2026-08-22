// Radial-gradient program. A quad centered on the gradient
// origin, size = 2·radius. The fragment stage samples the `u_stops` 1D LUT at
// t = length(uv - 0.5)·2.
//
// @location / @binding numbers match batchLayout.ts: a_unit/a_center/a_radAlpha
// at LOC_GRAD_UNIT/CENTER/RADALPHA (0/1/2), Frame UBO at FRAME_UBO_BINDING (0),
// u_stops at texture unit 0. The projection matrix already maps device px →
// clip with the Y-flip, so shaders are generated with --keep-coordinate-space.
//
// Sampler-binding convention: naga folds a texture and its sampler into one
// GLSL `sampler2D` named after the texture, and the reflection records only the
// texture's binding (= the GL texture unit). A sampler's own @binding is
// therefore invisible to the WebGL2 backend. It only has to be unique within
// the module. We place each sampler at `texture_binding + 16`, clear of every
// texture unit (0..15) and UBO binding (0..7), so it never collides.

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

@group(1) @binding(0) var u_stops: texture_2d<f32>;
@group(1) @binding(16) var u_stopsSamp: sampler;

struct VOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) uv: vec2<f32>,
  @location(1) @interpolate(flat) alpha: f32,
};

@vertex
fn vs_main(
  @location(0) a_unit: vec2<f32>,
  @location(1) a_center: vec2<f32>,
  @location(2) a_radAlpha: vec2<f32>,
) -> VOut {
  var out: VOut;
  let radius = a_radAlpha.x;
  let p = a_center + (a_unit - vec2<f32>(0.5)) * 2.0 * radius;
  let clip = frame.proj * vec3<f32>(p, 1.0);
  out.pos = vec4<f32>(clip.xy, 0.0, 1.0);
  out.uv = a_unit;
  out.alpha = a_radAlpha.y;
  return out;
}

@fragment
fn fs_main(in: VOut) -> @location(0) vec4<f32> {
  let t = length(in.uv - vec2<f32>(0.5)) * 2.0;
  if (t > 1.0) {
    discard;
  }
  // Sample horizontally through the LUT, y = 0.5 reads the center row.
  let c = textureSample(u_stops, u_stopsSamp, vec2<f32>(t, 0.5));
  return c * (in.alpha * clipCoverage(in.pos.xy));
}
