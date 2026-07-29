// Ambient-occlusion G-buffer prepass. Draws opaque geometry and packs, per
// pixel: the view-space normal (octahedral, RG) and 16-bit LINEAR view depth
// (BA). Linear depth (not hyperbolic window depth) keeps precision uniform so
// reconstructed neighbour positions don't jitter into self-occlusion; a stored
// normal (vs one reconstructed from depth) stays accurate on flat/grazing
// faces. A plain depth attachment resolves visibility but is never sampled
// (naga can't cross-compile a depth-texture read to WebGL2 GLSL). Single-sample,
// before the main MSAA pass.
//
// Bindings: a_position (0) + a_normal (1); frame block (view-projection + view +
// near/far) at CAMERA3D_UBO_BINDING (1) group 0; per-object block (model) at
// MESH_OBJECT_UBO_BINDING (5) group 1.

struct Frame {
  viewProj: mat4x4<f32>,
  view: mat4x4<f32>,
  nearFar: vec4<f32>, // x = near, y = far
};
@group(0) @binding(1) var<uniform> frame: Frame;

struct Obj {
  model: mat4x4<f32>,
};
@group(1) @binding(5) var<uniform> obj: Obj;

struct VOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) viewNormal: vec3<f32>,
  @location(1) viewZ: f32,
};

fn signNotZero(v: vec2<f32>) -> vec2<f32> {
  return vec2<f32>(
    select(-1.0, 1.0, v.x >= 0.0),
    select(-1.0, 1.0, v.y >= 0.0),
  );
}

// Octahedral encode a unit vector to `[0,1]^2`.
fn octEncode(n: vec3<f32>) -> vec2<f32> {
  let d = abs(n.x) + abs(n.y) + abs(n.z);
  let p = n.xy / max(d, 1e-8);
  let enc = select(p, (1.0 - abs(p.yx)) * signNotZero(p), n.z < 0.0);
  return enc * 0.5 + 0.5;
}

// Pack a `[0,1]` scalar into two 8-bit channels (16-bit).
fn pack16(v: f32) -> vec2<f32> {
  let s = clamp(v, 0.0, 1.0) * 65535.0;
  let hi = floor(s / 256.0);
  return vec2<f32>(hi / 255.0, (s - hi * 256.0) / 255.0);
}

@vertex
fn vs_main(
  @location(0) a_position: vec3<f32>,
  @location(1) a_normal: vec3<f32>,
) -> VOut {
  var out: VOut;
  let world = obj.model * vec4<f32>(a_position, 1.0);
  out.pos = frame.viewProj * world;
  // View-space normal (exact for uniform scale + rotation; a slight skew under
  // non-uniform scale, acceptable for AO).
  out.viewNormal = (frame.view * obj.model * vec4<f32>(a_normal, 0.0)).xyz;
  out.viewZ = (frame.view * world).z;
  return out;
}

@fragment
fn fs_main(in: VOut) -> @location(0) vec4<f32> {
  let enc = octEncode(normalize(in.viewNormal));
  let near = frame.nearFar.x;
  let far = frame.nearFar.y;
  let lin = clamp((-in.viewZ - near) / max(far - near, 1e-4), 0.0, 1.0);
  let d = pack16(lin);
  return vec4<f32>(enc.x, enc.y, d.x, d.y);
}
