// Colored-triangle program. Streamed 2D fills: positions arrive already in
// device pixels (CPU-transformed before append), so the vertex stage only
// projects device-px → clip via the shared Frame matrix.
//
// The fragment stage writes the premultiplied per-vertex color (or, in
// gradient mode, a ramp sample), optionally modulated by a bitmap clip mask,
// and supports two HUD debug modes:
//   1 = overdraw, a constant dim premultiplied red that, under the batch's
//       forced-additive blend, accumulates into a drawn-pixel heatmap.
//   2 = batch-color, a distinct per-batch hue assigned CPU-side.
// The clip is a multiply (not a `discard` hard cut) so it doesn't defeat the
// MSAA coverage AA on polygon edges.
//
// Bindings match batchLayout.ts: a_pos/a_color/a_uv at LOC_COLORED_* (0/1/2),
// Frame at FRAME_UBO_BINDING (0), DrawParams at DRAWPARAMS_UBO_BINDING (2),
// u_clipTex at texture unit 1, u_ramp (the shared ramp atlas) at texture unit
// 3. Sampler at texture_binding + 16 (see gradientRadial.wgsl for the
// convention).

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

// Device-px fragment position, corrected for WebGL2's bottom-up
// `gl_FragCoord.y`. Shared by the analytic clip and the gradient axis
// projection, both of which were computed CPU-side in this same convention.
fn devicePos(fragPos: vec2<f32>) -> vec2<f32> {
  let fy = select(fragPos.y, frame.targetH - fragPos.y, frame.fragYFlip > 0.5);
  return vec2<f32>(fragPos.x, fy);
}

// Analytic clip coverage in device px. Multiply the premultiplied fragment
// output by this.
fn clipRoundBox(p: vec2<f32>, b: vec2<f32>, rad: f32) -> f32 {
  let q = abs(p) - b + vec2<f32>(rad);
  return min(max(q.x, q.y), 0.0) + length(max(q, vec2<f32>(0.0))) - rad;
}
fn clipCoverage(fragPos: vec2<f32>) -> f32 {
  if (clipShape.kind < 0.5) { return 1.0; }
  let p = devicePos(fragPos) - vec2<f32>(clipShape.cx, clipShape.cy);
  var d: f32;
  if (clipShape.kind < 1.5) {
    d = length(p) - clipShape.r;
  } else {
    d = clipRoundBox(p, vec2<f32>(clipShape.halfW, clipShape.halfH), clipShape.rrRadius);
  }
  return clamp(0.5 - d / max(fwidth(d), 1e-4), 0.0, 1.0);
}

// 8x8 ordered (Bayer) dither, values 0..63. Breaks up 8-bit quantization
// banding on a smooth ramp (a gradient, an analytic shadow, the outset
// path-shadow composite) without the directional streaking a simple
// hash-based noise leaves on a slow gradient.
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

// Per-run paint/debug/clip params.
struct DrawParams {
  debugColor: vec4<f32>, // premultiplied hue for batch-color mode
  paint: vec4<f32>,      // gradient: (scaleDirX, scaleDirY, startOffset, rampRow)
  misc: vec4<f32>,       // reserved for a future per-run field (opacity at .y)
  flags: vec4<u32>,      // (clipEnabled, debugMode, paintMode, dither)
};
@group(1) @binding(2) var<uniform> params: DrawParams;

@group(1) @binding(1) var u_clipTex: texture_2d<f32>;
@group(1) @binding(17) var u_clipSamp: sampler;
@group(1) @binding(3) var u_ramp: texture_2d<f32>;
@group(1) @binding(19) var u_rampSamp: sampler;

struct VOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) color: vec4<f32>,
  @location(1) uv: vec2<f32>,
};

@vertex
fn vs_main(
  @location(0) a_pos: vec2<f32>,
  @location(1) a_color: vec4<f32>,
  @location(2) a_uv: vec2<f32>,
) -> VOut {
  var out: VOut;
  let clip = frame.proj * vec3<f32>(a_pos, 1.0);
  out.pos = vec4<f32>(clip.xy, 0.0, 1.0);
  out.color = a_color;
  out.uv = a_uv;
  return out;
}

@fragment
fn fs_main(in: VOut) -> @location(0) vec4<f32> {
  let paintMode = params.flags.z;
  var c: vec4<f32>;
  if (paintMode == 1u) {
    // Linear gradient: axis projection in device px (see `packing.ts`'s
    // `gradientAxis`), sampled through the shared ramp atlas.
    let p = devicePos(in.pos.xy);
    let t = clamp(dot(p, params.paint.xy) - params.paint.z, 0.0, 1.0);
    // See gradientRadial.wgsl: remap onto texel centers so t = 0 and t = 1
    // read the first and last atlas texel exactly.
    let u = t * (255.0 / 256.0) + 0.5 / 256.0;
    // ATLAS_ROWS must match TextureManager.ts.
    let v = (params.paint.w + 0.5) / 64.0;
    c = textureSample(u_ramp, u_rampSamp, vec2<f32>(u, v)) * params.misc.y;
  } else {
    c = in.color;
  }
  if (params.flags.x > 0u) {
    c = c * textureSample(u_clipTex, u_clipSamp, in.uv).a;
  }
  c *= clipCoverage(in.pos.xy);
  if (params.flags.w > 0u) {
    // Sub-LSB: this only changes which side of a quantization boundary a
    // pixel lands on. Clamped to `c.a` because adding a flat offset to the
    // rgb of a premultiplied color can push a saturated channel above its
    // own alpha.
    let noise = ((bayerValue(in.pos.xy) - 0.5) / 256.0) * c.a;
    c = vec4<f32>(min(c.rgb + noise, vec3<f32>(c.a)), c.a);
  }
  let mode = params.flags.y;
  if (mode == 1u) {
    // Dim premultiplied red. `lighter` blend accumulates it into a heatmap.
    c = vec4<f32>(0.05, 0.0, 0.0, 0.05);
  } else if (mode == 2u) {
    c = params.debugColor;
  }
  return c;
}
