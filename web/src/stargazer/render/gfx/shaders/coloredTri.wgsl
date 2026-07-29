// Colored-triangle program. Streamed 2D fills: positions arrive already in
// device pixels (CPU-transformed before append), so the vertex stage only
// projects device-px → clip via the shared Frame matrix.
//
// The fragment stage writes the premultiplied per-vertex color, optionally
// modulated by a bitmap clip mask, and supports two HUD debug modes:
//   1 = overdraw, a constant dim premultiplied red that, under the batch's
//       forced-additive blend, accumulates into a drawn-pixel heatmap.
//   2 = batch-color, a distinct per-batch hue assigned CPU-side.
// The clip is a multiply (not a `discard` hard cut) so it doesn't defeat the
// MSAA coverage AA on polygon edges.
//
// Bindings match batchLayout.ts: a_pos/a_color/a_uv at LOC_COLORED_* (0/1/2),
// Frame at FRAME_UBO_BINDING (0), DrawParams at DRAWPARAMS_UBO_BINDING (2),
// u_clipTex at texture unit 1. Sampler at texture_binding + 16 (see
// gradientRadial.wgsl for the convention).

struct Frame {
  proj: mat3x3<f32>,
};
@group(0) @binding(0) var<uniform> frame: Frame;

// Per-run debug/clip params. Ints are carried as floats so the block stays a
// plain vec4 + 4 floats (std140: 32 B, matches DRAWPARAMS_BYTES).
struct DrawParams {
  debugColor: vec4<f32>,   // premultiplied hue for batch-color mode
  clipEnabled: f32,        // 1.0 when a clip mask is bound
  debugMode: f32,          // 0 normal, 1 overdraw, 2 batch-color
  pad: vec2<f32>,
};
@group(1) @binding(2) var<uniform> params: DrawParams;

@group(1) @binding(1) var u_clipTex: texture_2d<f32>;
@group(1) @binding(17) var u_clipSamp: sampler;

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
  var c = in.color;
  if (params.clipEnabled > 0.5) {
    c = c * textureSample(u_clipTex, u_clipSamp, in.uv).a;
  }
  let mode = i32(params.debugMode + 0.5);
  if (mode == 1) {
    // Dim premultiplied red. `lighter` blend accumulates it into a heatmap.
    c = vec4<f32>(0.05, 0.0, 0.0, 0.05);
  } else if (mode == 2) {
    c = params.debugColor;
  }
  return c;
}
