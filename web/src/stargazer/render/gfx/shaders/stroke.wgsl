// Instanced-segment stroke program. Expanded-quad line technique: one instance per
// polyline segment, a 6-vert [0,1]×[0,1] unit template. The vertex stage extends
// the quad by (halfWidth + 1 px) past each endpoint so the fragment stage's
// round-cap AA falls inside the quad without a second draw.
//
// The fragment stage is a signed-distance-to-segment with round caps (endpoint
// distance when `along` is outside [0, segLen]), 1-px smoothstep AA, and dashing
// via `mod(dashStart + along, period)` fading out the off half. `dashPeriod == 0`
// is the no-dash fast path. Colors are premultiplied, scaling by a linear
// coverage alpha keeps that.
//
// Bindings match batchLayout.ts: a_unit/a_p0/a_p1/a_color/a_widthDash at
// LOC_STROKE_* (0..4), Frame at FRAME_UBO_BINDING (0).

struct Frame {
  proj: mat3x3<f32>,
};
@group(0) @binding(0) var<uniform> frame: Frame;

struct VOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) alongPerp: vec2<f32>,          // (along, perp) in segment-local px
  @location(1) @interpolate(flat) segLen: f32,
  @location(2) @interpolate(flat) halfWidth: f32,
  @location(3) @interpolate(flat) dashStart: f32,
  @location(4) @interpolate(flat) dashPeriod: f32,
  @location(5) @interpolate(flat) dashOnLen: f32,
  @location(6) @interpolate(flat) color: vec4<f32>,
};

@vertex
fn vs_main(
  @location(0) a_unit: vec2<f32>,
  @location(1) a_p0: vec2<f32>,
  @location(2) a_p1: vec2<f32>,
  @location(3) a_color: vec4<f32>,
  @location(4) a_widthDash: vec4<f32>,        // (width, dashStart, dashPeriod, dashOnLen)
) -> VOut {
  var out: VOut;
  let seg = a_p1 - a_p0;
  let segLen = length(seg);
  // Degenerate p0==p1 (join discs at interior vertices): tangent defaults to +x.
  // The distance test only reads the endpoint case there anyway.
  let tangent = select(vec2<f32>(1.0, 0.0), seg / segLen, segLen > 1e-6);
  let normal = vec2<f32>(-tangent.y, tangent.x);
  let halfWidth = a_widthDash.x * 0.5;
  // Extend by (halfWidth + 1) on all sides for round caps + AA. Map a_unit to
  // segment-local: along ∈ [-ext, segLen+ext], perp ∈ [-ext, +ext].
  let ext = halfWidth + 1.0;
  let along = mix(-ext, segLen + ext, a_unit.x);
  let perp = (a_unit.y - 0.5) * 2.0 * ext;
  let p = a_p0 + tangent * along + normal * perp;
  let clip = frame.proj * vec3<f32>(p, 1.0);
  out.pos = vec4<f32>(clip.xy, 0.0, 1.0);
  out.alongPerp = vec2<f32>(along, perp);
  out.segLen = segLen;
  out.halfWidth = halfWidth;
  out.dashStart = a_widthDash.y;
  out.dashPeriod = a_widthDash.z;
  out.dashOnLen = a_widthDash.w;
  out.color = a_color;
  return out;
}

@fragment
fn fs_main(in: VOut) -> @location(0) vec4<f32> {
  let along = in.alongPerp.x;
  let perp = in.alongPerp.y;
  var dist: f32;
  if (along < 0.0) {
    dist = length(vec2<f32>(along, perp));
  } else if (along > in.segLen) {
    dist = length(vec2<f32>(along - in.segLen, perp));
  } else {
    dist = abs(perp);
  }
  var alpha = 1.0 - smoothstep(in.halfWidth - 0.5, in.halfWidth + 0.5, dist);
  if (in.dashPeriod > 0.0) {
    let dashAlong = clamp(along, 0.0, in.segLen);
    let s = in.dashStart + dashAlong;
    // GLSL mod (floored), not WGSL `%` (truncated). Matters for negative phase.
    let phase = s - in.dashPeriod * floor(s / in.dashPeriod);
    let off = smoothstep(in.dashOnLen - 0.5, in.dashOnLen + 0.5, phase);
    alpha = alpha * (1.0 - off);
  }
  if (alpha <= 0.0) {
    discard;
  }
  return in.color * alpha;
}
