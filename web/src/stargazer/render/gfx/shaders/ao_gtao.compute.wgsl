// Screen-space ambient occlusion — compute path (WebGPU). Mirrors the math in
// `ao_gtao.wgsl` (the fragment off-ramp); keep in sync. Reads the G-buffer's
// stored view normal (octahedral, RG) + 16-bit linear view depth (BA) with
// textureLoad (point sampling — the packed bytes must not be bilinear-filtered),
// reconstructs view-space position, and writes the scalar AO to a storage
// texture. shader-gen skips this file — naga's GLSL backend has no compute stage.
//
// Bindings: u_gbuf (sampled) at 0, u_out (storage) at 1, Params at 6.

struct Params {
  invProj: mat4x4<f32>,
  resTexel: vec4<f32>,
  radiusIntBias: vec4<f32>,
  stepsNearFar: vec4<f32>,
  proj: vec4<f32>,
};
@group(0) @binding(6) var<uniform> params: Params;
@group(0) @binding(0) var u_gbuf: texture_2d<f32>;
@group(0) @binding(1) var u_out: texture_storage_2d<rgba8unorm, write>;

fn octDecode(e: vec2<f32>) -> vec3<f32> {
  let f = e * 2.0 - 1.0;
  var n = vec3<f32>(f.x, f.y, 1.0 - abs(f.x) - abs(f.y));
  let t = max(-n.z, 0.0);
  n.x += select(t, -t, n.x >= 0.0);
  n.y += select(t, -t, n.y >= 0.0);
  return normalize(n);
}

fn unpack16(ba: vec2<f32>) -> f32 {
  return (ba.x * 255.0 * 256.0 + ba.y * 255.0) / 65535.0;
}

fn loadG(uv: vec2<f32>) -> vec4<f32> {
  let res = params.resTexel.xy;
  let c = clamp(vec2<i32>(uv * res), vec2<i32>(0), vec2<i32>(res) - vec2<i32>(1));
  return textureLoad(u_gbuf, c, 0);
}

fn ndcXY(uv: vec2<f32>) -> vec2<f32> {
  let x = uv.x * 2.0 - 1.0;
  let y = select(uv.y * 2.0 - 1.0, 1.0 - uv.y * 2.0, params.proj.w > 0.5);
  return vec2<f32>(x, y);
}

fn viewPos(uv: vec2<f32>, lin: f32) -> vec3<f32> {
  let xy = ndcXY(uv);
  let a4 = params.invProj * vec4<f32>(xy, params.stepsNearFar.w, 1.0);
  let b4 = params.invProj * vec4<f32>(xy, params.proj.x, 1.0);
  let a = a4.xyz / a4.w;
  let b = b4.xyz / b4.w;
  let viewZ = -mix(params.stepsNearFar.y, params.stepsNearFar.z, lin);
  let t = (viewZ - a.z) / (b.z - a.z);
  return a + t * (b - a);
}

// Interleaved gradient noise (Jimenez) — a low-discrepancy screen-space dither
// that the bilateral blur cleans up far better than white noise.
fn hash(p: vec2<f32>) -> f32 {
  return fract(52.9829189 * fract(dot(p, vec2<f32>(0.06711056, 0.00583715))));
}

const PI = 3.14159265;

fn computeAO(uv: vec2<f32>) -> f32 {
  let g = loadG(uv);
  let lin = unpack16(g.ba);
  if (lin >= 0.9999) {
    return 1.0;
  }
  let N = octDecode(g.rg);
  let P = viewPos(uv, lin);
  let radius = params.radiusIntBias.x;
  let intensity = params.radiusIntBias.y;
  let bias = params.radiusIntBias.z;
  let slices = i32(params.radiusIntBias.w);
  let steps = i32(params.stepsNearFar.x);
  let invZ = 1.0 / max(0.05, -P.z);
  let srUV = vec2<f32>(
    radius * params.proj.y * invZ * 0.5,
    radius * params.proj.z * invZ * 0.5,
  );
  let rot = hash(uv * params.resTexel.xy) * 2.0 * PI;

  var occ = 0.0;
  for (var s = 0; s < slices; s = s + 1) {
    let ang = rot + f32(s) * (2.0 * PI / f32(slices));
    let dir = vec2<f32>(cos(ang), sin(ang));
    for (var t = 1; t <= steps; t = t + 1) {
      let suv = uv + dir * srUV * (f32(t) / f32(steps));
      if (any(suv < vec2<f32>(0.0)) || any(suv > vec2<f32>(1.0))) {
        continue;
      }
      let sl = unpack16(loadG(suv).ba);
      if (sl >= 0.9999) {
        continue;
      }
      let dv = viewPos(suv, sl) - P;
      let dist = length(dv);
      if (dist < 1e-4 || dist > radius) {
        continue;
      }
      let ndotv = dot(N, dv) / dist;
      if (ndotv <= bias) {
        continue;
      }
      occ = occ + ndotv * (1.0 - dist / radius);
    }
  }
  let ao = 1.0 - (occ / f32(max(slices * steps, 1))) * intensity;
  return clamp(ao, 0.0, 1.0);
}

@compute @workgroup_size(8, 8)
fn cs_main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let res = params.resTexel.xy;
  let coord = vec2<i32>(i32(gid.x), i32(gid.y));
  if (coord.x >= i32(res.x) || coord.y >= i32(res.y)) {
    return;
  }
  let uv = (vec2<f32>(coord) + vec2<f32>(0.5)) * params.resTexel.zw;
  let ao = computeAO(uv);
  textureStore(u_out, coord, vec4<f32>(ao, ao, ao, 1.0));
}
