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
const float PI = 3.141592653589793;

in vec3 v_worldPos;
in vec3 v_normal;
in vec2 v_uv;
in vec4 v_tangent;

uniform vec4 u_baseColorFactor; // straight rgba; a folds in node alpha
uniform float u_metallicFactor;
uniform float u_roughnessFactor;
uniform vec4 u_emissiveFactor; // xyz linear
uniform float u_occlusionStrength;
uniform float u_normalScale;
uniform int u_alphaMode; // 0 opaque, 1 mask, 2 blend
uniform float u_alphaCutoff;
uniform float u_diffuseTransmission;
uniform float u_hasTangent;

uniform sampler2D u_baseColorTex;
uniform sampler2D u_metalRoughTex;
uniform sampler2D u_normalTex;
uniform sampler2D u_occlusionTex;
uniform sampler2D u_emissiveTex;
uniform sampler2D u_diffuseTransmissionTex;
uniform float u_hasBaseColorTex;
uniform float u_hasMetalRoughTex;
uniform float u_hasNormalTex;
uniform float u_hasOcclusionTex;
uniform float u_hasEmissiveTex;
uniform float u_hasDiffTransTex;

uniform vec4 u_eyePos; // xyz world eye
uniform int u_lightCount;
uniform vec4 u_lightColor[MAX_LIGHTS]; // rgb * intensity
uniform vec4 u_lightPos[MAX_LIGHTS];   // xyz world pos, w = type (0 dir, 1 point, 2 spot)
uniform vec4 u_lightDir[MAX_LIGHTS];   // xyz direction of travel, w = range (0 = infinite)
uniform vec4 u_lightCone[MAX_LIGHTS];  // x = cos(inner), y = cos(outer)
uniform vec4 u_ambient;                // xyz ambient rgb
// Debug render view: 0 = normal, 1 = unshaded (albedo), 2 = normals (rgb).
uniform float u_debugMode;

// Shadows. One depth-array sampler holds directional + spot maps (a layer each),
// one cube sampler holds a single point light's map. u_lightShadow links a light
// to its map: x = kind (0 none, 1 array layer, 2 cube), y = layer index (kind 1)
// or far distance (kind 2), z = constant bias, w = normal bias. Shadow opacity
// rides u_lightColor[i].w. u_shadowTexel is 1 / shadowMapSize.
const int MAX_SHADOW_LAYERS = 4;
uniform sampler2DArrayShadow u_shadowArray;
uniform samplerCubeShadow u_shadowCube;
uniform mat4 u_shadowMat[MAX_SHADOW_LAYERS];
uniform vec4 u_lightShadow[MAX_LIGHTS];
uniform float u_shadowTexel;
uniform int u_shadowSamples; // PCF tap count (1 = hard)

// Distance fog. u_fogColor.rgb is the display-space tint, .w a 1/0 enable flag.
// u_fogParams packs the model (x: 0 exp, 1 linear), density (y), and linear
// start/end (z, w). Applied after tone-map so the tint reads as set.
uniform vec4 u_fogColor;
uniform vec4 u_fogParams;

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
 * hardware 2×2 comparison (LINEAR + COMPARE), so four taps read a soft ~3×3
 * kernel. Outside the map (or past the far plane) reads as fully lit.
 */
float sampleShadowArray(int layer, vec3 uvz) {
  if (uvz.x < 0.0 || uvz.x > 1.0 || uvz.y < 0.0 || uvz.y > 1.0 || uvz.z > 1.0) {
    return 1.0;
  }
  float fl = float(layer);
  float t = u_shadowTexel;
  float s = 0.0;
  for (int i = 0; i < MAX_PCF; i++) {
    if (i >= u_shadowSamples) break;
    s += texture(u_shadowArray, vec4(uvz.xy + PCF_DISK[i] * t, fl, uvz.z));
  }
  return s / float(u_shadowSamples);
}

/**
 * Shadow visibility (1 lit, 0 shadowed) for light `i`. Offsets the sample point
 * along the geometric normal (grazing-angle-scaled, then stripped of its
 * along-light component) to fight acne without peter-panning, then compares in
 * the light's map. `L` points toward the light.
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
  vec4 baseColor = u_baseColorFactor;
  if (u_hasBaseColorTex > 0.5) baseColor *= texture(u_baseColorTex, v_uv);
  float alpha = baseColor.a;
  if (u_alphaMode == 1 && alpha < u_alphaCutoff) discard;

  // Geometric normal, flipped on back faces so double-sided surfaces shade and
  // transmit toward the correct hemisphere.
  vec3 N = normalize(v_normal);
  if (!gl_FrontFacing) N = -N;

  if (u_hasNormalTex > 0.5) {
    vec3 tn = texture(u_normalTex, v_uv).xyz * 2.0 - 1.0;
    tn.xy *= u_normalScale;
    mat3 TBN;
    if (u_hasTangent > 0.5) {
      vec3 T = normalize(v_tangent.xyz);
      vec3 B = normalize(cross(N, T) * v_tangent.w);
      TBN = mat3(T, B, N);
    } else {
      TBN = derivativeTBN(N);
    }
    N = normalize(TBN * tn);
  }

  if (u_debugMode > 1.5) {
    outColor = vec4((N * 0.5 + 0.5) * alpha, alpha);
    return;
  }
  if (u_debugMode > 0.5) {
    outColor = vec4(linearToSrgb(baseColor.rgb) * alpha, alpha);
    return;
  }

  float metallic = u_metallicFactor;
  float roughness = u_roughnessFactor;
  if (u_hasMetalRoughTex > 0.5) {
    vec4 mr = texture(u_metalRoughTex, v_uv);
    roughness *= mr.g;
    metallic *= mr.b;
  }
  roughness = clamp(roughness, 0.04, 1.0);

  vec3 V = normalize(u_eyePos.xyz - v_worldPos);
  float NdotV = max(dot(N, V), 1e-4);
  vec3 F0 = mix(vec3(0.04), baseColor.rgb, metallic);
  vec3 diffuseColor = baseColor.rgb * (1.0 - metallic);

  vec3 Lo = vec3(0.0);
  for (int i = 0; i < MAX_LIGHTS; i++) {
    if (i >= u_lightCount) break;
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
    if (u_diffuseTransmission > 0.0) {
      vec3 tcol = diffuseColor;
      if (u_hasDiffTransTex > 0.5) tcol *= texture(u_diffuseTransmissionTex, v_uv).rgb;
      Lo += tcol * (u_diffuseTransmission * max(dot(-N, L), 0.0)) * radiance;
    }
  }

  float ao = 1.0;
  if (u_hasOcclusionTex > 0.5) {
    ao = mix(1.0, texture(u_occlusionTex, v_uv).r, u_occlusionStrength);
  }
  vec3 color = (Lo + u_ambient.xyz * diffuseColor) * ao;

  vec3 emissive = u_emissiveFactor.xyz;
  if (u_hasEmissiveTex > 0.5) emissive *= texture(u_emissiveTex, v_uv).rgb;
  color += emissive;

  color = applyFog(linearToSrgb(color));
  outColor = vec4(color * alpha, alpha);
}
