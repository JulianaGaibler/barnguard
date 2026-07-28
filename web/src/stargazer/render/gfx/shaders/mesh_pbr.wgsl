// Metallic-roughness PBR program. Cook-Torrance GGX + Lambert, a wrap-around
// diffuse-transmission term for translucent surfaces, and a punctual light array
// (directional / point / spot) with shadow maps. Textures are sampled straight:
// base-color and emissive are sRGB-decoded by their storage, the rest linear.
// Lighting runs in linear space. The result is tone-mapped, sRGB-encoded (the
// backbuffer is gamma-space), then premultiplied to match the framebuffer.
//
// Bindings match batchLayout.ts + MeshRenderer.ts. Group 0 (per-frame): PbrFrame
// at CAMERA3D (1), Lights at MESH_LIGHTS (4), ShadowFrame at MESH_SHADOW (7),
// shadow array/cube at units 8/9. Group 1 (per-object): PbrObject at MESH_OBJECT
// (5), material textures at units 10..15. Attributes a_position/a_normal/a_uv/
// a_tangent at LOC_POSITION/NORMAL/UV/TANGENT (0..3). Samplers sit at
// texture_binding + 16 (invisible to the WebGL2 reflection, see gradientRadial).
//
// WGSL restricts `textureSample` and derivatives (`dpdx`/`dpdy`) to uniform
// control flow, so every material sample and the tangent-frame derivatives are
// taken once at the top of the fragment stage (all 6 material units are always
// bound, a 1×1 white placeholder stands in for an absent map) and the has-map
// flags select afterward. Shadow lookups use `textureSampleCompareLevel`, which
// naga lowers to a core-ES300 `textureGrad` (LOD 0, no extension) and is legal
// in the non-uniform shadow-bounds branches.

const MAX_LIGHTS: i32 = 8;
const MAX_PCF: i32 = 16;
const PI: f32 = 3.141592653589793;

struct PbrFrame {
  viewProj: mat4x4<f32>,
  eyePos: vec4<f32>,   // xyz world eye
  ambient: vec4<f32>,  // xyz ambient rgb
  fogColor: vec4<f32>,
  fogParams: vec4<f32>,
  debug: vec4<f32>,    // x = debug mode
};
@group(0) @binding(1) var<uniform> frame: PbrFrame;

struct PbrObject {
  model: mat4x4<f32>,
  normalMatrix: mat4x4<f32>,  // upper 3×3 used (mat4 to dodge std140 mat3 padding)
  baseColorFactor: vec4<f32>, // straight rgba, a folds in node alpha
  emissiveFactor: vec4<f32>,  // xyz linear
  matParams0: vec4<f32>,      // metallic, roughness, occlusionStrength, normalScale
  matParams1: vec4<f32>,      // alphaCutoff, diffuseTransmission, hasTangent, alphaMode
  hasTex0: vec4<f32>,         // hasBaseColor, hasMetalRough, hasNormal, hasOcclusion
  hasTex1: vec4<f32>,         // hasEmissive, hasDiffTrans, _, _
};
@group(1) @binding(5) var<uniform> obj: PbrObject;

// Per light: pos.w = type (0 dir, 1 point, 2 spot). dir.w = range (0 = infinite).
// cone = (cos inner, cos outer). color.w = shadow opacity. shadow = (kind,
// layer-or-far, const bias, normal bias). `lightCountV.x` = active count.
struct Lights {
  lightCountV: vec4<i32>,
  lightColor: array<vec4<f32>, 8>,
  lightPos: array<vec4<f32>, 8>,
  lightDir: array<vec4<f32>, 8>,
  lightCone: array<vec4<f32>, 8>,
  lightShadow: array<vec4<f32>, 8>,
};
@group(0) @binding(4) var<uniform> lights: Lights;

// `shadowMeta.x` = 1 / shadowMapSize, `.y` = PCF tap count (1 = hard).
struct ShadowFrame {
  shadowMat: array<mat4x4<f32>, 4>,
  shadowMeta: vec4<f32>,
};
@group(0) @binding(7) var<uniform> shadowF: ShadowFrame;

@group(0) @binding(8) var u_shadowArray: texture_depth_2d_array;
@group(0) @binding(24) var u_shadowArraySamp: sampler_comparison;
@group(0) @binding(9) var u_shadowCube: texture_depth_cube;
@group(0) @binding(25) var u_shadowCubeSamp: sampler_comparison;

@group(1) @binding(10) var u_baseColorTex: texture_2d<f32>;
@group(1) @binding(26) var u_baseColorSamp: sampler;
@group(1) @binding(11) var u_metalRoughTex: texture_2d<f32>;
@group(1) @binding(27) var u_metalRoughSamp: sampler;
@group(1) @binding(12) var u_normalTex: texture_2d<f32>;
@group(1) @binding(28) var u_normalSamp: sampler;
@group(1) @binding(13) var u_occlusionTex: texture_2d<f32>;
@group(1) @binding(29) var u_occlusionSamp: sampler;
@group(1) @binding(14) var u_emissiveTex: texture_2d<f32>;
@group(1) @binding(30) var u_emissiveSamp: sampler;
@group(1) @binding(15) var u_diffuseTransmissionTex: texture_2d<f32>;
@group(1) @binding(31) var u_diffuseTransmissionSamp: sampler;

const PCF_DISK = array<vec2<f32>, 16>(
  vec2<f32>(0.0, 0.0), vec2<f32>(-1.0, -1.0), vec2<f32>(1.0, -1.0), vec2<f32>(-1.0, 1.0),
  vec2<f32>(1.0, 1.0), vec2<f32>(-1.0, 0.0), vec2<f32>(1.0, 0.0), vec2<f32>(0.0, -1.0),
  vec2<f32>(0.0, 1.0), vec2<f32>(-2.0, -0.6), vec2<f32>(2.0, 0.6), vec2<f32>(-0.6, 2.0),
  vec2<f32>(0.6, -2.0), vec2<f32>(-2.0, 1.4), vec2<f32>(2.0, -1.4), vec2<f32>(1.4, 2.0),
);

struct VOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) worldPos: vec3<f32>,
  @location(1) normal: vec3<f32>,
  @location(2) uv: vec2<f32>,
  @location(3) tangent: vec4<f32>,
};

// Upper-left 3×3 of a mat4.
fn mat3of(m: mat4x4<f32>) -> mat3x3<f32> {
  return mat3x3<f32>(m[0].xyz, m[1].xyz, m[2].xyz);
}

@vertex
fn vs_main(
  @location(0) a_position: vec3<f32>,
  @location(1) a_normal: vec3<f32>,
  @location(2) a_uv: vec2<f32>,
  @location(3) a_tangent: vec4<f32>,
) -> VOut {
  var out: VOut;
  let worldPos = obj.model * vec4<f32>(a_position, 1.0);
  out.worldPos = worldPos.xyz;
  out.pos = frame.viewProj * worldPos;
  let nm = mat3of(obj.normalMatrix);
  out.normal = nm * a_normal;
  out.tangent = vec4<f32>(nm * a_tangent.xyz, a_tangent.w);
  out.uv = a_uv;
  return out;
}

fn linearToSrgb(c: vec3<f32>) -> vec3<f32> {
  let lo = c * 12.92;
  let hi = 1.055 * pow(max(c, vec3<f32>(0.0)), vec3<f32>(1.0 / 2.4)) - vec3<f32>(0.055);
  return mix(lo, hi, step(vec3<f32>(0.0031308), c));
}

// Blend toward the fog tint by camera distance, rgb only, alpha untouched.
fn applyFog(color: vec3<f32>, worldPos: vec3<f32>) -> vec3<f32> {
  if (frame.fogColor.w < 0.5) {
    return color;
  }
  let dist = length(frame.eyePos.xyz - worldPos);
  var f: f32;
  if (frame.fogParams.x < 0.5) {
    f = 1.0 - exp(-frame.fogParams.y * dist); // exp
  } else {
    f = clamp((dist - frame.fogParams.z) / max(frame.fogParams.w - frame.fogParams.z, 1e-4),
              0.0, 1.0); // linear
  }
  return mix(color, frame.fogColor.rgb, f);
}

fn distributionGGX(NdotH: f32, rough: f32) -> f32 {
  let a = rough * rough;
  let a2 = a * a;
  let d = NdotH * NdotH * (a2 - 1.0) + 1.0;
  return a2 / max(PI * d * d, 1e-7);
}

fn geometrySchlickGGX(NdotX: f32, k: f32) -> f32 {
  return NdotX / (NdotX * (1.0 - k) + k);
}

fn geometrySmith(NdotV: f32, NdotL: f32, rough: f32) -> f32 {
  let r = rough + 1.0;
  let k = (r * r) / 8.0;
  return geometrySchlickGGX(NdotV, k) * geometrySchlickGGX(NdotL, k);
}

fn fresnelSchlick(cosT: f32, F0: vec3<f32>) -> vec3<f32> {
  return F0 + (vec3<f32>(1.0) - F0) * pow(clamp(1.0 - cosT, 0.0, 1.0), 5.0);
}

// 4-tap (or `shadowMeta.y`) PCF against a depth-array layer. `uvz` is the
// fragment in the map's [0,1] space (xy texel coord, z compare depth). Outside
// the map (or past the far plane) reads fully lit.
fn sampleShadowArray(layer: i32, uvz: vec3<f32>) -> f32 {
  if (uvz.x < 0.0 || uvz.x > 1.0 || uvz.y < 0.0 || uvz.y > 1.0 || uvz.z > 1.0) {
    return 1.0;
  }
  let samples = i32(shadowF.shadowMeta.y + 0.5);
  let t = shadowF.shadowMeta.x;
  var s = 0.0;
  for (var i = 0; i < MAX_PCF; i = i + 1) {
    if (i >= samples) {
      break;
    }
    s = s + textureSampleCompareLevel(
      u_shadowArray, u_shadowArraySamp, uvz.xy + PCF_DISK[i] * t, layer, uvz.z);
  }
  return s / f32(samples);
}

// Shadow visibility (1 lit, 0 shadowed) for light `i`. Offsets along the
// geometric normal to fight acne without peter-panning, then compares in the
// light's map. `L` points toward the light.
fn shadowVisibility(i: i32, L: vec3<f32>, worldPos: vec3<f32>, normal: vec3<f32>) -> f32 {
  let kind = i32(lights.lightShadow[i].x + 0.5);
  if (kind == 0) {
    return 1.0;
  }
  let gN = normalize(normal);
  var base = gN * ((1.0 - clamp(dot(L, gN), 0.0, 1.0)) * lights.lightShadow[i].w);
  base = base - L * dot(L, base);
  let wp = worldPos + base;
  var shadow: f32;
  if (kind == 1) {
    let layer = i32(lights.lightShadow[i].y + 0.5);
    let sc = shadowF.shadowMat[layer] * vec4<f32>(wp, 1.0);
    // NDC [-1,1] → [0,1] for both texel coord and compare depth.
    var uvz = (sc.xyz / sc.w) * 0.5 + vec3<f32>(0.5);
    uvz.z = uvz.z - lights.lightShadow[i].z;
    shadow = sampleShadowArray(layer, uvz);
  } else {
    // Point cube: bias in world units before the /far divide stays stable.
    let toFrag = wp - lights.lightPos[i].xyz;
    let refDepth = (length(toFrag) - lights.lightShadow[i].z) / lights.lightShadow[i].y;
    shadow = textureSampleCompareLevel(
      u_shadowCube, u_shadowCubeSamp, normalize(toFrag), refDepth);
  }
  return mix(1.0, shadow, lights.lightColor[i].w); // w = shadow opacity
}

// Tangent frame from screen-space derivatives when no TANGENT attribute.
fn derivativeTBN(N: vec3<f32>, dp1: vec3<f32>, dp2: vec3<f32>, duv1: vec2<f32>, duv2: vec2<f32>) -> mat3x3<f32> {
  var T = dp1 * duv2.y - dp2 * duv1.y;
  T = normalize(T - N * dot(N, T));
  let B = normalize(cross(N, T));
  return mat3x3<f32>(T, B, N);
}

@fragment
fn fs_main(in: VOut, @builtin(front_facing) frontFacing: bool) -> @location(0) vec4<f32> {
  // Hoisted to uniform control flow: material samples (auto-LOD preserved) and
  // the tangent-frame derivatives. The has-map flags select from these below.
  let baseTexel = textureSample(u_baseColorTex, u_baseColorSamp, in.uv);
  let mrTexel = textureSample(u_metalRoughTex, u_metalRoughSamp, in.uv);
  let normalTexel = textureSample(u_normalTex, u_normalSamp, in.uv);
  let occTexel = textureSample(u_occlusionTex, u_occlusionSamp, in.uv);
  let emissiveTexel = textureSample(u_emissiveTex, u_emissiveSamp, in.uv);
  let diffTransTexel = textureSample(u_diffuseTransmissionTex, u_diffuseTransmissionSamp, in.uv);
  let dp1 = dpdx(in.worldPos);
  let dp2 = dpdy(in.worldPos);
  let duv1 = dpdx(in.uv);
  let duv2 = dpdy(in.uv);

  let debugMode = frame.debug.x;
  let normalScale = obj.matParams0.w;
  let hasTangent = obj.matParams1.z;
  let alphaMode = i32(obj.matParams1.w + 0.5);
  let alphaCutoff = obj.matParams1.x;

  var baseColor = obj.baseColorFactor;
  if (obj.hasTex0.x > 0.5) {
    baseColor = baseColor * baseTexel;
  }
  let alpha = baseColor.a;
  if (alphaMode == 1 && alpha < alphaCutoff) {
    discard;
  }

  // Geometric normal, flipped on back faces so double-sided surfaces shade and
  // transmit toward the correct hemisphere.
  var N = normalize(in.normal);
  if (!frontFacing) {
    N = -N;
  }

  if (obj.hasTex0.z > 0.5) {
    var tn = normalTexel.xyz * 2.0 - vec3<f32>(1.0);
    tn = vec3<f32>(tn.xy * normalScale, tn.z);
    var TBN: mat3x3<f32>;
    if (hasTangent > 0.5) {
      let T = normalize(in.tangent.xyz);
      let B = normalize(cross(N, T) * in.tangent.w);
      TBN = mat3x3<f32>(T, B, N);
    } else {
      TBN = derivativeTBN(N, dp1, dp2, duv1, duv2);
    }
    N = normalize(TBN * tn);
  }

  if (debugMode > 1.5) {
    return vec4<f32>((N * 0.5 + 0.5) * alpha, alpha);
  }
  if (debugMode > 0.5) {
    return vec4<f32>(linearToSrgb(baseColor.rgb) * alpha, alpha);
  }

  var metallic = obj.matParams0.x;
  var roughness = obj.matParams0.y;
  if (obj.hasTex0.y > 0.5) {
    roughness = roughness * mrTexel.g;
    metallic = metallic * mrTexel.b;
  }
  roughness = clamp(roughness, 0.04, 1.0);

  let V = normalize(frame.eyePos.xyz - in.worldPos);
  let NdotV = max(dot(N, V), 1e-4);
  let F0 = mix(vec3<f32>(0.04), baseColor.rgb, metallic);
  let diffuseColor = baseColor.rgb * (1.0 - metallic);

  let diffuseTransmission = obj.matParams1.y;
  let lightCount = lights.lightCountV.x;
  var Lo = vec3<f32>(0.0);
  for (var i = 0; i < MAX_LIGHTS; i = i + 1) {
    if (i >= lightCount) {
      break;
    }
    let ltype = i32(lights.lightPos[i].w + 0.5);
    var L: vec3<f32>;
    var atten = 1.0;
    if (ltype == 0) {
      L = normalize(-lights.lightDir[i].xyz);
    } else {
      let toL = lights.lightPos[i].xyz - in.worldPos;
      let dist = max(length(toL), 1e-4);
      L = toL / dist;
      atten = 1.0 / max(dist * dist, 1e-4);
      let range = lights.lightDir[i].w;
      if (range > 0.0) {
        let f = clamp(1.0 - pow(dist / range, 4.0), 0.0, 1.0);
        atten = atten * f * f;
      }
      if (ltype == 2) {
        let cd = dot(normalize(lights.lightDir[i].xyz), -L);
        atten = atten * clamp(
          (cd - lights.lightCone[i].y) / max(lights.lightCone[i].x - lights.lightCone[i].y, 1e-4),
          0.0, 1.0);
      }
    }
    let radiance = lights.lightColor[i].xyz * atten * shadowVisibility(i, L, in.worldPos, in.normal);
    let NdotL = max(dot(N, L), 0.0);
    let H = normalize(V + L);
    let NdotH = max(dot(N, H), 0.0);
    let NDF = distributionGGX(NdotH, roughness);
    let G = geometrySmith(NdotV, NdotL, roughness);
    let F = fresnelSchlick(max(dot(H, V), 0.0), F0);
    let spec = (NDF * G * F) / max(4.0 * NdotV * NdotL, 1e-4);
    let kd = (vec3<f32>(1.0) - F) * (1.0 - metallic);
    Lo = Lo + (kd * diffuseColor / PI + spec) * radiance * NdotL;
    if (diffuseTransmission > 0.0) {
      var tcol = diffuseColor;
      if (obj.hasTex1.y > 0.5) {
        tcol = tcol * diffTransTexel.rgb;
      }
      Lo = Lo + tcol * (diffuseTransmission * max(dot(-N, L), 0.0)) * radiance;
    }
  }

  var ao = 1.0;
  if (obj.hasTex0.w > 0.5) {
    ao = mix(1.0, occTexel.r, obj.matParams0.z);
  }
  var color = (Lo + frame.ambient.xyz * diffuseColor) * ao;

  var emissive = obj.emissiveFactor.xyz;
  if (obj.hasTex1.x > 0.5) {
    emissive = emissive * emissiveTexel.rgb;
  }
  color = color + emissive;

  color = applyFog(linearToSrgb(color), in.worldPos);
  return vec4<f32>(color * alpha, alpha);
}
