// Offscreen composite. Draws a rectangle of an offscreen surface into the
// enclosing target with a group opacity, optionally multiplied by a second
// surface that acts as a track matte. Both surfaces hold premultiplied color and
// cover the same rectangle, so one UV addresses both.
//
// Positions arrive in device pixels, already transformed on the CPU. The
// surface texture is sampled with the UV the CPU computed for the backend's
// texture row order.
//
// Bindings: a_pos/a_uv at locations 0/1, Frame at group 0 binding 0, Params at
// group 1 binding 2, u_tex at binding 1, u_matte at binding 3. Samplers sit at
// texture binding + 16.

struct Frame {
  proj: mat3x3<f32>,
  targetH: f32,
  fragYFlip: f32,
};
@group(0) @binding(0) var<uniform> frame: Frame;

// matteMode: 0 none, 1 alpha, 2 inverted alpha, 3 luma, 4 inverted luma.
struct Params {
  opacity: f32,
  matteMode: f32,
  pad0: f32,
  pad1: f32,
};
@group(1) @binding(2) var<uniform> params: Params;

@group(1) @binding(1) var u_tex: texture_2d<f32>;
@group(1) @binding(17) var u_texSamp: sampler;
@group(1) @binding(3) var u_matte: texture_2d<f32>;
@group(1) @binding(19) var u_matteSamp: sampler;

struct VOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

@vertex
fn vs_main(
  @location(0) a_pos: vec2<f32>,
  @location(1) a_uv: vec2<f32>,
) -> VOut {
  var out: VOut;
  let clip = frame.proj * vec3<f32>(a_pos, 1.0);
  out.pos = vec4<f32>(clip.xy, 0.0, 1.0);
  out.uv = a_uv;
  return out;
}

@fragment
fn fs_main(in: VOut) -> @location(0) vec4<f32> {
  var c = textureSample(u_tex, u_texSamp, in.uv);
  let mode = params.matteMode;
  if (mode > 0.5) {
    let m = textureSample(u_matte, u_matteSamp, in.uv);
    var f = m.a;
    if (mode > 2.5) {
      f = dot(m.rgb, vec3<f32>(0.2125, 0.7154, 0.0721));
    }
    if ((mode > 1.5 && mode < 2.5) || mode > 3.5) {
      f = 1.0 - f;
    }
    c = c * f;
  }
  return c * params.opacity;
}
