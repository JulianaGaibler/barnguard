// Retained colored-fill program. Positions arrive in the geometry's own local
// space (uploaded once to a static buffer). A per-draw model matrix places them
// on the GPU, so the CPU never re-transforms vertices. The flat color, the
// gradient axis, and the inset-shadow mask rect all share one per-draw block so
// one dynamic-offset slice feeds every mode.
//
// Bindings match batchLayout.ts: a_pos at LOC_COLORED_POS (0), Frame at
// FRAME_UBO_BINDING (0), ModelColor at MODELCOLOR_UBO_BINDING (3), Clip at
// CLIP_UBO_BINDING (8). u_ramp and u_mask are local to this program, see
// coloredTri.ts.
//
// This program carries the analytic clip, a flat fill, a linear gradient fill,
// and an inset path-shadow mask, but not the bitmap clip mask or the debug
// recolor, which live on the streamed program. `GpuGfx` falls back to the
// streamed path for those two. An analytic clip must not force that fallback,
// since it is the common case and the retained path exists to skip the CPU
// transform.

struct Frame {
  proj: mat3x3<f32>,
  targetH: f32,
  fragYFlip: f32,
};
@group(0) @binding(0) var<uniform> frame: Frame;

// #include "include/clipUniform.inc.wgsl"

// Device-px fragment position, corrected for WebGL2's bottom-up
// `gl_FragCoord.y`. Shared by the analytic clip and the gradient/mask
// projections, both of which were computed CPU-side in this same convention.
fn devicePos(fragPos: vec2<f32>) -> vec2<f32> {
  let fy = select(fragPos.y, frame.targetH - fragPos.y, frame.fragYFlip > 0.5);
  return vec2<f32>(fragPos.x, fy);
}


// Per-draw model matrix, paint, and mode (std140: mat3 = 3×vec4 = 48 B, +
// vec4 color + vec4 paint + vec4<u32> flags + vec4 paintOffset = 112 B,
// matches MODELCOLOR_BYTES). `paint`'s meaning depends on `flags.x`
// (paintMode), the same two shapes `coloredTri.wgsl`'s `DrawParams.paint`
// takes: gradient mode reads it as the axis projection (scaleDirX, scaleDirY,
// startOffset, rampRow); inset-mask mode reads it as the rows of the
// device-to-mask-uv map, with the offsets in `paintOffset.xy`. `color` is the
// flat fill in mode 0, the
// shadow tint in mode 2, and unused except for its alpha (the run's opacity
// multiplier, the ramp's own stops are already premultiplied) in mode 1.
struct ModelColor {
  model: mat3x3<f32>,
  color: vec4<f32>,
  paint: vec4<f32>,
  flags: vec4<u32>, // (paintMode, reserved, reserved, reserved)
  paintOffset: vec4<f32>, // mask: uv offsets in xy
};
@group(1) @binding(3) var<uniform> draw: ModelColor;

@group(1) @binding(4) var u_ramp: texture_2d<f32>;
@group(1) @binding(20) var u_rampSamp: sampler;
@group(1) @binding(5) var u_mask: texture_2d<f32>;
@group(1) @binding(21) var u_maskSamp: sampler;

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
  let paintMode = draw.flags.x;
  var c: vec4<f32>;
  if (paintMode == 1u) {
    // Linear gradient: axis projection in device px (see `packing.ts`'s
    // `gradientAxis`), sampled through the shared ramp atlas. Mirrors
    // `coloredTri.wgsl`'s gradient branch.
    let p = devicePos(in.pos.xy);
    let t = clamp(dot(p, draw.paint.xy) - draw.paint.z, 0.0, 1.0);
    let u = t * (255.0 / 256.0) + 0.5 / 256.0;
    let v = (draw.paint.w + 0.5) / 64.0;
    c = textureSample(u_ramp, u_rampSamp, vec2<f32>(u, v)) * draw.color.a;
  } else {
    c = draw.color;
  }
  if (paintMode == 2u) {
    // Inset path shadow: the geometry drawn here is the path's own fill, so
    // no clip and no extra pass is needed, only a sample of the cached mask
    // in the paint slot. Mirrors `coloredTri.wgsl`'s inset-mask branch.
    let p = devicePos(in.pos.xy);
    let uv = vec2<f32>(dot(p, draw.paint.xy), dot(p, draw.paint.zw)) + draw.paintOffset.xy;
    let uvInside = all(uv >= vec2<f32>(0.0)) && all(uv <= vec2<f32>(1.0));
    let maskR = select(0.0, textureSample(u_mask, u_maskSamp, uv).r, uvInside);
    c = c * (1.0 - maskR);
  }
  return c * clipCoverage(in.pos.xy);
}
