// Ambient-occlusion bilateral blur — fragment path (WebGL2). Separable: run once
// horizontally then once vertically. Each tap is weighted by a spatial Gaussian
// and a depth term (from the G-buffer's packed depth) so the blur smooths the
// noisy AO without bleeding across silhouettes. `ao_blur.compute.wgsl` mirrors
// this; keep the two in sync.
//
// Bindings: u_ao at unit 0 (sampler +16), u_gbuf at unit 1 (sampler +17),
// Params at 6, a_pos at location 0.

struct BlurParams {
  // xy = blur direction in texels ((1,0) horizontal, (0,1) vertical); zw = resolution.
  dirRes: vec4<f32>,
  // x = depth sigma (edge-stop tightness); rest unused.
  control: vec4<f32>,
};
@group(0) @binding(6) var<uniform> params: BlurParams;
@group(0) @binding(0) var u_ao: texture_2d<f32>;
@group(0) @binding(16) var u_aoSamp: sampler;
@group(0) @binding(1) var u_gbuf: texture_2d<f32>;
@group(0) @binding(17) var u_gbufSamp: sampler;

struct VOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

@vertex
fn vs_main(@location(0) a_pos: vec2<f32>) -> VOut {
  var out: VOut;
  out.uv = a_pos * 0.5 + vec2<f32>(0.5);
  out.pos = vec4<f32>(a_pos, 0.0, 1.0);
  return out;
}

fn unpack16(ba: vec2<f32>) -> f32 {
  return (ba.x * 255.0 * 256.0 + ba.y * 255.0) / 65535.0;
}

const KR = 6;

fn blurAt(uv: vec2<f32>) -> f32 {
  let dirUv = params.dirRes.xy / params.dirRes.zw;
  let sigma = params.control.x;
  let spatialDenom = 2.0 * (f32(KR) * f32(KR) * 0.25);
  let cAO = textureSampleLevel(u_ao, u_aoSamp, uv, 0.0).r;
  let cD = unpack16(textureSampleLevel(u_gbuf, u_gbufSamp, uv, 0.0).ba);
  var sum = cAO;
  var wsum = 1.0;
  for (var i = 1; i <= KR; i = i + 1) {
    let sw = exp(-f32(i * i) / spatialDenom);
    for (var sgn = -1; sgn <= 1; sgn = sgn + 2) {
      let o = dirUv * (f32(i) * f32(sgn));
      let sAO = textureSampleLevel(u_ao, u_aoSamp, uv + o, 0.0).r;
      let sD = unpack16(textureSampleLevel(u_gbuf, u_gbufSamp, uv + o, 0.0).ba);
      let dd = sD - cD;
      let dw = exp(-(dd * dd) / max(1e-6, 2.0 * sigma * sigma));
      let w = sw * dw;
      sum = sum + sAO * w;
      wsum = wsum + w;
    }
  }
  return sum / wsum;
}

@fragment
fn fs_main(in: VOut) -> @location(0) vec4<f32> {
  let a = blurAt(in.uv);
  return vec4<f32>(a, a, a, 1.0);
}
