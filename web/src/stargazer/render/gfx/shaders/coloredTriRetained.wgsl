// Retained colored-fill program. Positions arrive in the geometry's own local
// space (uploaded once to a static buffer). A per-draw model matrix places them
// on the GPU, so the CPU never re-transforms vertices. The flat premultiplied
// color rides in the same per-draw block so one dynamic-offset slice feeds both
// stages.
//
// Bindings match batchLayout.ts: a_pos at LOC_COLORED_POS (0), Frame at
// FRAME_UBO_BINDING (0), ModelColor at MODELCOLOR_UBO_BINDING (3), Clip at
// CLIP_UBO_BINDING (8).
//
// This program carries the analytic clip but not the bitmap clip mask or the
// debug recolor, which live on the streamed program. `GpuGfx.fillPath2D` falls
// back to the streamed path for those two. An analytic clip must not force that
// fallback, since it is the common case and the retained path exists to skip
// the CPU transform.

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

// Analytic clip coverage in device px. frame.fragYFlip corrects WebGL2's
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

// Per-draw model matrix + flat color (std140: mat3 = 3×vec4 = 48 B, + vec4 =
// 64 B, matches MODELCOLOR_BYTES).
struct ModelColor {
  model: mat3x3<f32>,
  color: vec4<f32>,
};
@group(1) @binding(3) var<uniform> draw: ModelColor;

struct VOut {
  @builtin(position) pos: vec4<f32>,
};

@vertex
fn vs_main(@location(0) a_pos: vec2<f32>) -> VOut {
  var out: VOut;
  let world = draw.model * vec3<f32>(a_pos, 1.0);
  let clip = frame.proj * vec3<f32>(world.xy, 1.0);
  out.pos = vec4<f32>(clip.xy, 0.0, 1.0);
  return out;
}

@fragment
fn fs_main(in: VOut) -> @location(0) vec4<f32> {
  return draw.color * clipCoverage(in.pos.xy);
}
