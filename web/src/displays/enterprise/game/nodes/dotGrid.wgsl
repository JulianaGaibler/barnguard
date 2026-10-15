// Dot grid for the enterprise overlay. One quad covers the whole grid and every
// pixel finds its own cell, so the cost does not depend on how many dots are
// lit. A cell's dot grows from nothing to `Params.shape.y` of the cell as its
// value goes from 0 to 1, and the dots never touch.
//
// u_cells is a cols x rows texture, row 0 at the top of the quad. R is the warn
// value and G the pulse value. The pulse dot draws over the warn dot.
//
// Bindings follow the engine's shader-quad contract: Frame at 0 and Clip at 8
// in group 0, the draw's Params at 10 and u_cells at binding 0 in group 1.

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

struct Params {
  // cols, rows, dot diameter as a fraction of the cell at value 1, and how many
  // cells the dots fade over at the grid's edges (0 for no fade)
  shape: vec4<f32>,
  // rgb, opacity of a fully grown dot
  warn: vec4<f32>,
  pulse: vec4<f32>,
};
@group(1) @binding(10) var<uniform> params: Params;
@group(1) @binding(0) var u_cells: texture_2d<f32>;

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

struct VOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) uv: vec2<f32>,
  @location(1) @interpolate(flat) alpha: f32,
};

@vertex
fn vs_main(
  @location(0) a_unit: vec2<f32>,
  @location(1) a_originAxisX: vec4<f32>,
  @location(2) a_axisYAlpha: vec4<f32>,
) -> VOut {
  var out: VOut;
  let pos = a_originAxisX.xy + a_originAxisX.zw * a_unit.x + a_axisYAlpha.xy * a_unit.y;
  let clip = frame.proj * vec3<f32>(pos, 1.0);
  out.pos = vec4<f32>(clip.xy, 0.0, 1.0);
  out.uv = a_unit;
  out.alpha = a_axisYAlpha.z;
  return out;
}

// Coverage of a dot of the given value at `local`, in cell units from the
// cell's centre. `aa` is one pixel in the same units.
fn dot(local: vec2<f32>, value: f32, aa: f32) -> f32 {
  let radius = value * params.shape.z * 0.5;
  let d = length(local) - radius;
  return select(0.0, clamp(0.5 - d / aa, 0.0, 1.0), value > 0.002);
}

@fragment
fn fs_main(in: VOut) -> @location(0) vec4<f32> {
  let grid = params.shape.xy;
  let g = in.uv * grid;
  let cell = vec2<i32>(clamp(floor(g), vec2<f32>(0.0), grid - vec2<f32>(1.0)));
  let local = fract(g) - vec2<f32>(0.5);
  let aa = max(fwidth(g.x), 1e-4);
  let v = textureLoad(u_cells, cell, 0);

  // Dots shrink away over the outermost cells, so the grid has no hard rim.
  let edge = min(
    min(in.uv.x, 1.0 - in.uv.x) * grid.x,
    min(in.uv.y, 1.0 - in.uv.y) * grid.y,
  );
  let fade = select(1.0, smoothstep(0.0, max(params.shape.w, 1e-4), edge), params.shape.w > 0.0);

  let warnA = dot(local, v.r * fade, aa) * params.warn.w;
  let pulseA = dot(local, v.g * fade, aa) * params.pulse.w;
  let rgb = params.pulse.rgb * pulseA + params.warn.rgb * warnA * (1.0 - pulseA);
  let a = pulseA + warnA * (1.0 - pulseA);
  return vec4<f32>(rgb, a) * (in.alpha * clipCoverage(in.pos.xy));
}
