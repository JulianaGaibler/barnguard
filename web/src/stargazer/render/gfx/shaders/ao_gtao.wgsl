// Screen-space ambient occlusion — fragment path (WebGL2, and any backend
// without compute). Reads the G-buffer's stored view normal (octahedral, RG)
// and 16-bit LINEAR view depth (BA), reconstructs view-space position along the
// pixel's view ray (near→far, exact for ortho + perspective), and estimates
// occlusion with a hemisphere-obscurance sum. Output is a scalar AO in `[0,1]`.
//
// The compute path (`ao_gtao.compute.wgsl`) mirrors this math; keep in sync.
//
// The G-buffer packs a 16-bit depth and an octahedral normal into RGBA8, so it
// MUST be point-sampled — bilinear filtering would interpolate the packed bytes
// and scramble both. Reads therefore use textureLoad (integer texels).
//
// Bindings: u_gbuf at unit 0, Params at 6, a_pos at location 0.

struct Params {
  invProj: mat4x4<f32>,
  // x,y = resolution px; z,w = texel size (1/res).
  resTexel: vec4<f32>,
  // x = radius (view units); y = intensity; z = angle bias (sin of the min
  // elevation counted as occlusion); w = slices.
  radiusIntBias: vec4<f32>,
  // x = steps; y = near; z = far; w = ndc-z of the near plane.
  stepsNearFar: vec4<f32>,
  // x = ndc-z of the far plane; y = projection[0][0]; z = projection[1][1];
  // w = flipY (1 → uv.y=0 is the top of NDC, for top-down textures).
  proj: vec4<f32>,
};
@group(0) @binding(6) var<uniform> params: Params;
@group(0) @binding(0) var u_gbuf: texture_2d<f32>;

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

// UV → NDC xy. NDC y points up; a top-down texture (uv.y=0 at the top) flips it.
fn ndcXY(uv: vec2<f32>) -> vec2<f32> {
  let x = uv.x * 2.0 - 1.0;
  let y = select(uv.y * 2.0 - 1.0, 1.0 - uv.y * 2.0, params.proj.w > 0.5);
  return vec2<f32>(x, y);
}

// Reconstruct view-space position: interpolate between the near- and far-plane
// points of this pixel's view ray by the linear depth. A straight line in view
// space, so exact for both perspective and orthographic projections.
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
  // Far-plane texels (cleared background) are unoccluded.
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
  // Radius in UV per axis, from the projection scale (handles FOV + aspect).
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
      // Elevation above the tangent plane; the angle bias rejects near-coplanar
      // neighbours (self-occlusion) proportionally, at any distance.
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

@fragment
fn fs_main(in: VOut) -> @location(0) vec4<f32> {
  let ao = computeAO(in.uv);
  return vec4<f32>(ao, ao, ao, 1.0);
}
