#version 300 es
precision highp float;
// Shadow sampler types have no default precision in GLSL ES 3.00 (unlike plain
// sampler2D), so they must be declared explicitly.
precision highp sampler2DArrayShadow;
precision highp samplerCubeShadow;
// Metallic-roughness PBR fragment stage (Cook-Torrance GGX + Lambert), a
// wrap-around diffuse-transmission term for translucent surfaces, and a punctual
// light array (directional / point / spot). Textures are sampled straight:
// base-color and emissive are sRGB-decoded by their SRGB8_ALPHA8 storage, the
// rest are linear. Lighting runs in linear space; the result is tone-mapped and
// sRGB-encoded (the backbuffer is gamma-space), then premultiplied by alpha to
// match the engine's premultiplied framebuffer.

const int MAX_LIGHTS = 8;
const int MAX_SHADOW_LAYERS = 4;
const float PI = 3.141592653589793;

in vec3 v_worldPos;
in vec3 v_normal;
in vec2 v_uv;
in vec4 v_tangent;

// Per-frame block (see CAMERA3D_UBO_BINDING). `u_debug.x` = debug view (0 normal,
// 1 unshaded albedo, 2 normals). `u_fogColor.rgb` display-space tint, `.w` a 1/0
// enable flag; `u_fogParams` packs mode (x), density (y), start/end (z, w).
layout(std140) uniform PbrFrame {
  mat4 u_viewProj;
  vec4 u_eyePos;   // xyz world eye
  vec4 u_ambient;  // xyz ambient rgb
  vec4 u_fogColor;
  vec4 u_fogParams;
  vec4 u_debug;    // x = debug mode
};

// Per-object block, std140 (dynamic-offset ring). `u_normalMatrix` stored as a
// mat4 (upper 3x3 used). Scalars packed into vec4s; see field comments.
layout(std140) uniform PbrObject {
  mat4 u_model;
  mat4 u_normalMatrix;
  vec4 u_baseColorFactor; // straight rgba; a folds in node alpha
  vec4 u_emissiveFactor;  // xyz linear
  vec4 u_matParams0;      // metallic, roughness, occlusionStrength, normalScale
  vec4 u_matParams1;      // alphaCutoff, diffuseTransmission, hasTangent, alphaMode
  vec4 u_hasTex0;         // hasBaseColor, hasMetalRough, hasNormal, hasOcclusion
  vec4 u_hasTex1;         // hasEmissive, hasDiffTrans, _, _
};

// Punctual light array, std140 (see MESH_LIGHTS_UBO_BINDING). `u_lightCountV.x`
// = active count. Per light: pos.w = type (0 dir, 1 point, 2 spot); dir.w =
// range (0 = infinite); cone = (cos inner, cos outer); color.w = shadow opacity;
// shadow = (kind, layer-or-far, const bias, normal bias).
layout(std140) uniform Lights {
  ivec4 u_lightCountV;
  vec4 u_lightColor[MAX_LIGHTS];
  vec4 u_lightPos[MAX_LIGHTS];
  vec4 u_lightDir[MAX_LIGHTS];
  vec4 u_lightCone[MAX_LIGHTS];
  vec4 u_lightShadow[MAX_LIGHTS];
};

// Shadow maps: one depth-array (directional + spot, a layer each) and one cube
// (a single point light). `u_shadowMeta.x` = 1 / shadowMapSize, `.y` = PCF tap
// count (1 = hard).
uniform sampler2DArrayShadow u_shadowArray;
uniform samplerCubeShadow u_shadowCube;
layout(std140) uniform ShadowFrame {
  mat4 u_shadowMat[MAX_SHADOW_LAYERS];
  vec4 u_shadowMeta;
};

uniform sampler2D u_baseColorTex;
uniform sampler2D u_metalRoughTex;
uniform sampler2D u_normalTex;
uniform sampler2D u_occlusionTex;
uniform sampler2D u_emissiveTex;
uniform sampler2D u_diffuseTransmissionTex;

const int MAX_PCF = 16;
const vec2 PCF_DISK[16] = vec2[16](
  vec2(0.0, 0.0), vec2(-1.0, -1.0), vec2(1.0, -1.0), vec2(-1.0, 1.0),
  vec2(1.0, 1.0), vec2(-1.0, 0.0), vec2(1.0, 0.0), vec2(0.0, -1.0),
  vec2(0.0, 1.0), vec2(-2.0, -0.6), vec2(2.0, 0.6), vec2(-0.6, 2.0),
  vec2(0.6, -2.0), vec2(-2.0, 1.4), vec2(2.0, -1.4), vec2(1.4, 2.0)
);

out vec4 outColor;

vec3 linearToSrgb(vec3 c) {
  vec3 lo = c * 12.92;
  vec3 hi = 1.055 * pow(max(c, vec3(0.0)), vec3(1.0 / 2.4)) - 0.055;
  return mix(lo, hi, step(vec3(0.0031308), c));
}

// Blend `color` (display-space rgb) toward the fog tint by camera distance.
// Fog rides on rgb only; alpha is untouched, so premultiply still holds after.
vec3 applyFog(vec3 color) {
  if (u_fogColor.w < 0.5) return color;
  float dist = length(u_eyePos.xyz - v_worldPos);
  float f;
  if (u_fogParams.x < 0.5) {
    f = 1.0 - exp(-u_fogParams.y * dist); // exp
  } else {
    f = clamp((dist - u_fogParams.z) / max(u_fogParams.w - u_fogParams.z, 1e-4),
              0.0, 1.0); // linear
  }
  return mix(color, u_fogColor.rgb, f);
}

float distributionGGX(float NdotH, float rough) {
  float a = rough * rough;
  float a2 = a * a;
  float d = NdotH * NdotH * (a2 - 1.0) + 1.0;
  return a2 / max(PI * d * d, 1e-7);
}

float geometrySchlickGGX(float NdotX, float k) {
  return NdotX / (NdotX * (1.0 - k) + k);
}

float geometrySmith(float NdotV, float NdotL, float rough) {
  float r = rough + 1.0;
  float k = (r * r) / 8.0;
  return geometrySchlickGGX(NdotV, k) * geometrySchlickGGX(NdotL, k);
}

vec3 fresnelSchlick(float cosT, vec3 F0) {
  return F0 + (1.0 - F0) * pow(clamp(1.0 - cosT, 0.0, 1.0), 5.0);
}

/**
 * 4-tap PCF against a depth-array layer. `uvz` is the fragment in the map's
 * [0,1] space (xy = texel coord, z = compare depth). Each tap is itself a
 * hardware 2×2 comparison (LINEAR + COMPARE). Outside the map (or past the far
 * plane) reads as fully lit.
 */
float sampleShadowArray(int layer, vec3 uvz) {
  if (uvz.x < 0.0 || uvz.x > 1.0 || uvz.y < 0.0 || uvz.y > 1.0 || uvz.z > 1.0) {
    return 1.0;
  }
  int samples = int(u_shadowMeta.y + 0.5);
  float fl = float(layer);
  float t = u_shadowMeta.x;
  float s = 0.0;
  for (int i = 0; i < MAX_PCF; i++) {
    if (i >= samples) break;
    s += texture(u_shadowArray, vec4(uvz.xy + PCF_DISK[i] * t, fl, uvz.z));
  }
  return s / float(samples);
}

/**
 * Shadow visibility (1 lit, 0 shadowed) for light `i`. Offsets the sample point
 * along the geometric normal to fight acne without peter-panning, then compares
 * in the light's map. `L` points toward the light.
 */
float shadowVisibility(int i, vec3 L) {
  int kind = int(u_lightShadow[i].x + 0.5);
  if (kind == 0) return 1.0;
  vec3 gN = normalize(v_normal);
  vec3 base = gN * ((1.0 - clamp(dot(L, gN), 0.0, 1.0)) * u_lightShadow[i].w);
  base -= L * dot(L, base);
  vec3 wp = v_worldPos + base;
  float shadow;
  if (kind == 1) {
    int layer = int(u_lightShadow[i].y + 0.5);
    vec4 sc = u_shadowMat[layer] * vec4(wp, 1.0);
    // NDC [-1,1] → [0,1] for both the texel coord and the compare depth.
    vec3 uvz = (sc.xyz / sc.w) * 0.5 + 0.5;
    uvz.z -= u_lightShadow[i].z;
    shadow = sampleShadowArray(layer, uvz);
  } else {
    // Point cube: bias in world units before the /far divide keeps it stable
    // across scene sizes.
    vec3 toFrag = wp - u_lightPos[i].xyz;
    float ref = (length(toFrag) - u_lightShadow[i].z) / u_lightShadow[i].y;
    shadow = texture(u_shadowCube, vec4(normalize(toFrag), ref));
  }
  return mix(1.0, shadow, u_lightColor[i].w); // w = shadow opacity
}

/** Tangent frame from screen-space derivatives when no TANGENT attribute. */
mat3 derivativeTBN(vec3 N) {
  vec3 dp1 = dFdx(v_worldPos);
  vec3 dp2 = dFdy(v_worldPos);
  vec2 duv1 = dFdx(v_uv);
  vec2 duv2 = dFdy(v_uv);
  vec3 T = dp1 * duv2.y - dp2 * duv1.y;
  T = normalize(T - N * dot(N, T));
  vec3 B = normalize(cross(N, T));
  return mat3(T, B, N);
}

void main() {
  float debugMode = u_debug.x;
  float normalScale = u_matParams0.w;
  float hasTangent = u_matParams1.z;
  int alphaMode = int(u_matParams1.w + 0.5);
  float alphaCutoff = u_matParams1.x;

  vec4 baseColor = u_baseColorFactor;
  if (u_hasTex0.x > 0.5) baseColor *= texture(u_baseColorTex, v_uv);
  float alpha = baseColor.a;
  if (alphaMode == 1 && alpha < alphaCutoff) discard;

  // Geometric normal, flipped on back faces so double-sided surfaces shade and
  // transmit toward the correct hemisphere.
  vec3 N = normalize(v_normal);
  if (!gl_FrontFacing) N = -N;

  if (u_hasTex0.z > 0.5) {
    vec3 tn = texture(u_normalTex, v_uv).xyz * 2.0 - 1.0;
    tn.xy *= normalScale;
    mat3 TBN;
    if (hasTangent > 0.5) {
      vec3 T = normalize(v_tangent.xyz);
      vec3 B = normalize(cross(N, T) * v_tangent.w);
      TBN = mat3(T, B, N);
    } else {
      TBN = derivativeTBN(N);
    }
    N = normalize(TBN * tn);
  }

  if (debugMode > 1.5) {
    outColor = vec4((N * 0.5 + 0.5) * alpha, alpha);
    return;
  }
  if (debugMode > 0.5) {
    outColor = vec4(linearToSrgb(baseColor.rgb) * alpha, alpha);
    return;
  }

  float metallic = u_matParams0.x;
  float roughness = u_matParams0.y;
  if (u_hasTex0.y > 0.5) {
    vec4 mr = texture(u_metalRoughTex, v_uv);
    roughness *= mr.g;
    metallic *= mr.b;
  }
  roughness = clamp(roughness, 0.04, 1.0);

  vec3 V = normalize(u_eyePos.xyz - v_worldPos);
  float NdotV = max(dot(N, V), 1e-4);
  vec3 F0 = mix(vec3(0.04), baseColor.rgb, metallic);
  vec3 diffuseColor = baseColor.rgb * (1.0 - metallic);

  float diffuseTransmission = u_matParams1.y;
  int lightCount = u_lightCountV.x;
  vec3 Lo = vec3(0.0);
  for (int i = 0; i < MAX_LIGHTS; i++) {
    if (i >= lightCount) break;
    int type = int(u_lightPos[i].w + 0.5);
    vec3 L;
    float atten = 1.0;
    if (type == 0) {
      L = normalize(-u_lightDir[i].xyz);
    } else {
      vec3 toL = u_lightPos[i].xyz - v_worldPos;
      float dist = max(length(toL), 1e-4);
      L = toL / dist;
      atten = 1.0 / max(dist * dist, 1e-4);
      float range = u_lightDir[i].w;
      if (range > 0.0) {
        float f = clamp(1.0 - pow(dist / range, 4.0), 0.0, 1.0);
        atten *= f * f;
      }
      if (type == 2) {
        float cd = dot(normalize(u_lightDir[i].xyz), -L);
        atten *= clamp(
          (cd - u_lightCone[i].y) / max(u_lightCone[i].x - u_lightCone[i].y, 1e-4),
          0.0,
          1.0
        );
      }
    }
    vec3 radiance = u_lightColor[i].xyz * atten * shadowVisibility(i, L);
    float NdotL = max(dot(N, L), 0.0);
    vec3 H = normalize(V + L);
    float NdotH = max(dot(N, H), 0.0);
    float NDF = distributionGGX(NdotH, roughness);
    float G = geometrySmith(NdotV, NdotL, roughness);
    vec3 F = fresnelSchlick(max(dot(H, V), 0.0), F0);
    vec3 spec = (NDF * G * F) / max(4.0 * NdotV * NdotL, 1e-4);
    vec3 kd = (vec3(1.0) - F) * (1.0 - metallic);
    Lo += (kd * diffuseColor / PI + spec) * radiance * NdotL;
    if (diffuseTransmission > 0.0) {
      vec3 tcol = diffuseColor;
      if (u_hasTex1.y > 0.5) tcol *= texture(u_diffuseTransmissionTex, v_uv).rgb;
      Lo += tcol * (diffuseTransmission * max(dot(-N, L), 0.0)) * radiance;
    }
  }

  float ao = 1.0;
  if (u_hasTex0.w > 0.5) {
    ao = mix(1.0, texture(u_occlusionTex, v_uv).r, u_matParams0.z);
  }
  vec3 color = (Lo + u_ambient.xyz * diffuseColor) * ao;

  vec3 emissive = u_emissiveFactor.xyz;
  if (u_hasTex1.x > 0.5) emissive *= texture(u_emissiveTex, v_uv).rgb;
  color += emissive;

  color = applyFog(linearToSrgb(color));
  outColor = vec4(color * alpha, alpha);
}
