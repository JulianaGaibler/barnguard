// Dot field for the enterprise epicenter's cone. One quad covers the cone's
// bounding square around the apex and every pixel finds its own lattice cell,
// so the cost does not depend on how many dots are drawn. The lattice is
// square, rotated to the cone's axis, with the apex on a lattice point. A cell
// draws a dot only when its centre lies inside the wedge, so dots at the
// wedge's edge stay whole.
//
// Dots shrink with distance from the apex, down to nothing toward the far end.
// A wave travels inward through the field. As the crest passes it enlarges
// each dot in proportion to its resting size, and adds a fixed amount so dots
// that rest at nothing light up too. Sizes ease into a soft ceiling, so small
// dots grow almost linearly while large ones level off before they touch.
//
// Two lines mark the wedge's edges, from the logo's edge out to the cone's
// reach, fading from full opacity to nothing as they go out. The draw sets
// their width in world units from a width in CSS pixels, so it holds at any
// zoom.
//
// Bindings follow the engine's shader-quad contract: Frame at 0 and Clip at 8
// in group 0, the draw's Params at 10 in group 1.

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
  pad0: f32,
  pad1: f32,
  // Corner radii: top left, top right, bottom right, bottom left.
  radii: vec4<f32>,
};
@group(0) @binding(8) var<uniform> clipShape: Clip;

struct Params {
  // cone length, half the sweep (radians), lattice pitch, and the diameter of
  // the largest resting dot as a fraction of the pitch
  shape: vec4<f32>,
  // unit axis (x, y), the intro grow scale on the cone length, wave phase in
  // [0, 1)
  axis: vec4<f32>,
  // wavelength, how much a crest enlarges a dot (1 doubles it), resting size
  // at the cone's far end as a fraction of the largest (below 0 leaves the
  // outer dots at nothing), crest sharpness
  wave: vec4<f32>,
  // rgb, opacity
  color: vec4<f32>,
  // radius around the apex left empty for the logo, the size a crest adds to
  // every dot as a fraction of the largest resting dot, the ceiling dot
  // diameter as a fraction of the pitch, the edge lines' width in world units
  extra: vec4<f32>,
};
@group(1) @binding(10) var<uniform> params: Params;

fn clipRoundBox(p: vec2<f32>, b: vec2<f32>, radii: vec4<f32>) -> f32 {
  // The radius of the corner in the point's quadrant.
  let column = select(radii.xw, radii.yz, p.x > 0.0);
  let rad = select(column.x, column.y, p.y > 0.0);
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
    d = clipRoundBox(p, vec2<f32>(clipShape.halfW, clipShape.halfH), clipShape.radii);
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

// Coverage of the edge line at angle `side × halfSweep`, at `q` in the axis
// frame. `px` is one device pixel in world units, for antialiasing.
fn edgeLine(q: vec2<f32>, side: f32, halfSweep: f32, inner: f32, reach: f32, px: f32) -> f32 {
  let dir = vec2<f32>(cos(halfSweep), side * sin(halfSweep));
  let t = dot(q, dir);
  let dist = length(q - dir * clamp(t, inner, reach));
  let halfWidth = 0.5 * params.extra.w;
  let cov = clamp((halfWidth - dist) / px + 0.5, 0.0, 1.0);
  let fade = 1.0 - clamp((t - inner) / max(reach - inner, 1e-4), 0.0, 1.0);
  return cov * fade;
}

@fragment
fn fs_main(in: VOut) -> @location(0) vec4<f32> {
  let len = params.shape.x;
  let halfSweep = params.shape.y;
  let pitch = params.shape.z;
  let axis = params.axis.xy;

  // Local position around the apex, then in the axis frame: x along the
  // axis, y across it.
  let p = (in.uv * 2.0 - vec2<f32>(1.0)) * len;
  let q = vec2<f32>(dot(p, axis), dot(p, vec2<f32>(-axis.y, axis.x)));
  let g = q / pitch;
  let cell = round(g);
  let local = g - cell;
  let aa = max(fwidth(g.x), 1e-4);

  let c = cell * pitch;
  let r = length(c);
  let inner = params.extra.x;
  let reach = len * params.axis.z;
  let inside = r > inner && r <= reach && abs(atan2(c.y, c.x)) <= halfSweep;

  let along = clamp((r - inner) / max(len - inner, 1e-4), 0.0, 1.0);
  let rest = max(mix(1.0, params.wave.z, along), 0.0);
  let crest = pow(0.5 + 0.5 * cos(6.2831853 * (r / params.wave.x + params.axis.w)), params.wave.w);
  let size = rest * (1.0 + params.wave.y * crest) + params.extra.y * crest;
  let ceiling = params.extra.z;
  let radius = 0.5 * ceiling * tanh(params.shape.w * size / ceiling);
  let d = length(local) - radius;
  let cov = select(0.0, clamp(0.5 - d / aa, 0.0, 1.0), inside);

  let px = aa * pitch;
  let line = max(
    edgeLine(q, 1.0, halfSweep, inner, reach, px),
    edgeLine(q, -1.0, halfSweep, inner, reach, px),
  );
  let a = (line + cov * (1.0 - line)) * params.color.w;
  return vec4<f32>(params.color.rgb * a, a) * (in.alpha * clipCoverage(in.pos.xy));
}
