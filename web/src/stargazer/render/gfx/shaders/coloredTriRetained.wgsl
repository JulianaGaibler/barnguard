// Retained colored-fill program. Positions arrive in the geometry's own local
// space (uploaded once to a static buffer). A per-draw model matrix places them
// on the GPU, so the CPU never re-transforms vertices. The flat premultiplied
// color rides in the same per-draw block so one dynamic-offset slice feeds both
// stages.
//
// Bindings match batchLayout.ts: a_pos at LOC_COLORED_POS (0), Frame at
// FRAME_UBO_BINDING (0), ModelColor at MODELCOLOR_UBO_BINDING (3).

struct Frame {
  proj: mat3x3<f32>,
};
@group(0) @binding(0) var<uniform> frame: Frame;

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
fn fs_main() -> @location(0) vec4<f32> {
  return draw.color;
}
