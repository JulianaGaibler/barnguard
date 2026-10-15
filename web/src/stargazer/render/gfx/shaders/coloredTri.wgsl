// Colored-triangle program. Streamed 2D fills: positions arrive already in
// device pixels (CPU-transformed before append), so the vertex stage only
// projects device-px -> clip via the shared Frame matrix.
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
// Bindings match batchLayout.ts: a_pos/a_color/a_uv/a_param at LOC_COLORED_*
// (0 to 3), Frame at FRAME_UBO_BINDING (0), the param table (clip records) at
// PARAM_TABLE_BINDING (10), DrawParams at DRAWPARAMS_UBO_BINDING (2),
// u_clipTex at texture unit 1, u_ramp (the shared ramp atlas) at texture unit
// 3, u_mask (an inset path-shadow's coverage mask) at texture unit 4. Sampler
// at texture_binding + 16 (see gradientRadial.wgsl for the convention).

struct Frame {
  proj: mat3x3<f32>,
  targetH: f32,
  fragYFlip: f32,
};
@group(0) @binding(0) var<uniform> frame: Frame;

// Device-px fragment position, corrected for WebGL2's bottom-up
// `gl_FragCoord.y`. Shared by the analytic clip and the gradient axis
// projection, both of which were computed CPU-side in this same convention.
fn devicePos(fragPos: vec2<f32>) -> vec2<f32> {
  let fy = select(fragPos.y, frame.targetH - fragPos.y, frame.fragYFlip > 0.5);
  return vec2<f32>(fragPos.x, fy);
}

// Per-primitive records, read by index in the vertex stage (see ParamTable.ts).
// Index 0 is the empty record: kind 0, which is no clip.
@group(0) @binding(10) var<storage, read> paramTable: array<vec4<f32>>;

// #include "include/clipRecord.inc.wgsl"

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

// Per-run paint/debug/clip params. `paint`'s meaning depends on `flags.z`
// (paintMode): gradient mode reads it as the axis projection (scaleDirX,
// scaleDirY, startOffset, rampRow); inset-mask mode reads it as the rows of
// the device-to-mask-uv map (u row in xy, v row in zw), with the offsets in
// `misc.xy`.
struct DrawParams {
  debugColor: vec4<f32>, // premultiplied hue for batch-color mode
  paint: vec4<f32>,
  misc: vec4<f32>,       // radial: (unused, opacity, ramp row), mask: uv offsets
  flags: vec4<u32>,      // (clipEnabled, debugMode, paintMode, dither)
  paintMap: vec4<f32>,   // radial: (offset.xy, focal-to-center vector)
};
@group(1) @binding(2) var<uniform> params: DrawParams;

@group(1) @binding(1) var u_clipTex: texture_2d<f32>;
@group(1) @binding(17) var u_clipSamp: sampler;
@group(1) @binding(3) var u_ramp: texture_2d<f32>;
@group(1) @binding(19) var u_rampSamp: sampler;
@group(1) @binding(4) var u_mask: texture_2d<f32>;
@group(1) @binding(20) var u_maskSamp: sampler;

struct VOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) color: vec4<f32>,
  @location(1) uv: vec2<f32>,
  // Flat: the clip's param record, four vec4s.
  @location(2) @interpolate(flat) clip0: vec4<f32>,
  @location(3) @interpolate(flat) clip1: vec4<f32>,
  @location(4) @interpolate(flat) clip2: vec4<f32>,
  @location(5) @interpolate(flat) clip3: vec4<f32>,
};

@vertex
fn vs_main(
  @location(0) a_pos: vec2<f32>,
  @location(1) a_color: vec4<f32>,
  @location(2) a_uv: vec2<f32>,
  @location(3) a_param: u32,
) -> VOut {
  var out: VOut;
  let rec = a_param * 4u;
  out.clip0 = paramTable[rec];
  out.clip1 = paramTable[rec + 1u];
  out.clip2 = paramTable[rec + 2u];
  out.clip3 = paramTable[rec + 3u];
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
  } else if (paintMode == 3u) {
    // Radial gradient with a focal point, in the gradient's own space scaled
    // to a unit circle with the focal point at the origin. `paint` holds the
    // rows of the map from a device position into that space, `paintMap` its
    // offset and the focal-to-center vector, `misc` is (unused, opacity, ramp
    // row). `t` is the scale of the circle through this pixel whose center
    // slides from the focal point to the center as its radius grows to 1. With
    // the focal point inside the circle the quadratic's leading term is
    // negative and the positive root is the one below.
    let p = devicePos(in.pos.xy);
    let d = vec2<f32>(dot(p, params.paint.xy), dot(p, params.paint.zw)) + params.paintMap.xy;
    let e = params.paintMap.zw;
    let a = min(dot(e, e) - 1.0, -1e-4);
    let de = dot(d, e);
    let disc = max(de * de - a * dot(d, d), 0.0);
    let t = clamp((de - sqrt(disc)) / a, 0.0, 1.0);
    let u = t * (255.0 / 256.0) + 0.5 / 256.0;
    let v = (params.misc.z + 0.5) / 64.0;
    c = textureSample(u_ramp, u_rampSamp, vec2<f32>(u, v)) * params.misc.y;
  } else {
    c = in.color;
  }
  if (paintMode == 2u) {
    // Inset path shadow: the geometry drawn here is the path's own fill, so
    // no clip and no extra pass is needed, only a sample of the cached mask
    // in the paint slot. Outside the mask's own (padded) rect the sample is
    // forced to 0, which inverts to full shadow: a point that far from the
    // silhouette has a true blurred coverage below one 8-bit level, and
    // `1 - 0` is exactly that.
    let p = devicePos(in.pos.xy);
    let uv = vec2<f32>(dot(p, params.paint.xy), dot(p, params.paint.zw)) + params.misc.xy;
    let uvInside = all(uv >= vec2<f32>(0.0)) && all(uv <= vec2<f32>(1.0));
    let maskR = select(0.0, textureSample(u_mask, u_maskSamp, uv).r, uvInside);
    c = c * (1.0 - maskR);
  }
  if (params.flags.x > 0u) {
    c = c * textureSample(u_clipTex, u_clipSamp, in.uv).a;
  }
  c *= clipCoverageRec(devicePos(in.pos.xy), in.clip0, in.clip1, in.clip2, in.clip3);
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
