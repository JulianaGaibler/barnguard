// Ambient-occlusion bilateral blur — compute path (WebGPU). Mirrors
// `ao_blur.wgsl`; keep in sync. Separable (run horizontally then vertically),
// each tap weighted by a spatial Gaussian and a depth term from the packed
// G-buffer depth. shader-gen skips this file (compute-only).
//
// Bindings: u_ao (sampled) at 0, u_gbuf (sampled) at 1, u_out (storage) at 2,
// Params at 6.

struct BlurParams {
  dirRes: vec4<f32>,
  control: vec4<f32>,
};
@group(0) @binding(6) var<uniform> params: BlurParams;
@group(0) @binding(0) var u_ao: texture_2d<f32>;
@group(0) @binding(1) var u_gbuf: texture_2d<f32>;
@group(0) @binding(2) var u_out: texture_storage_2d<rgba8unorm, write>;

fn unpack16(ba: vec2<f32>) -> f32 {
  return (ba.x * 255.0 * 256.0 + ba.y * 255.0) / 65535.0;
}

const KR = 6;

@compute @workgroup_size(8, 8)
fn cs_main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let res = vec2<i32>(params.dirRes.zw);
  let coord = vec2<i32>(i32(gid.x), i32(gid.y));
  if (coord.x >= res.x || coord.y >= res.y) {
    return;
  }
  let dir = vec2<i32>(i32(params.dirRes.x), i32(params.dirRes.y));
  let sigma = params.control.x;
  let spatialDenom = 2.0 * (f32(KR) * f32(KR) * 0.25);
  let cAO = textureLoad(u_ao, coord, 0).r;
  let cD = unpack16(textureLoad(u_gbuf, coord, 0).ba);
  var sum = cAO;
  var wsum = 1.0;
  for (var i = 1; i <= KR; i = i + 1) {
    let sw = exp(-f32(i * i) / spatialDenom);
    for (var sgn = -1; sgn <= 1; sgn = sgn + 2) {
      let sc = clamp(
        coord + dir * (i * sgn),
        vec2<i32>(0),
        res - vec2<i32>(1),
      );
      let sAO = textureLoad(u_ao, sc, 0).r;
      let sD = unpack16(textureLoad(u_gbuf, sc, 0).ba);
      let dd = sD - cD;
      let dw = exp(-(dd * dd) / max(1e-6, 2.0 * sigma * sigma));
      let w = sw * dw;
      sum = sum + sAO * w;
      wsum = wsum + w;
    }
  }
  let a = sum / wsum;
  textureStore(u_out, coord, vec4<f32>(a, a, a, 1.0));
}
