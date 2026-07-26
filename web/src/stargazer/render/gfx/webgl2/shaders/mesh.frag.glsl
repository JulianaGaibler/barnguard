#version 300 es
precision highp float;
// 3D mesh fragment stage. `u_lit` selects flat unlit color or a single
// directional light plus ambient. `u_useTexture` swaps in a sampled texture
// (a Viewport2DNode's rendered 2D surface), V-flipped from the y-down 2D content
// to the y-up sample space, and taken as already-premultiplied. Output is
// premultiplied alpha to match the engine's premultiplied framebuffer.

in vec3 v_worldPos;
in vec3 v_normal;
in vec2 v_uv;

uniform vec4 u_color;      // straight (non-premultiplied) rgba
uniform float u_lit;       // 1.0 = lit, 0.0 = unlit
uniform vec4 u_lightDir;   // xyz: world-space direction the light travels
uniform vec4 u_lightColor; // xyz: rgb
uniform vec4 u_ambient;    // xyz: rgb
uniform float u_useTexture; // 1.0 = sample u_texture, 0.0 = use u_color
uniform sampler2D u_texture;
// Debug render view: 0 = normal, 1 = unshaded (flat albedo, no lighting),
// 2 = normals (rgb = world normal * 0.5 + 0.5).
uniform float u_debugMode;

// Distance fog. u_eyePos.xyz is the world-space camera. u_fogColor.rgb is the
// display-space fog tint, .w a 1/0 enable flag. u_fogParams packs the model
// (x: 0 exp, 1 linear), density (y), and linear start/end (z, w).
uniform vec4 u_eyePos;
uniform vec4 u_fogColor;
uniform vec4 u_fogParams;

out vec4 outColor;

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

void main() {
  float a = u_color.a;
  // Normals view applies to all geometry regardless of texture/lighting.
  if (u_debugMode > 1.5) {
    vec3 n = normalize(v_normal);
    outColor = vec4((n * 0.5 + 0.5) * a, a);
    return;
  }
  if (u_useTexture > 0.5) {
    // The 2D surface is rendered premultiplied; sample it straight, V-flipped.
    // Un-premultiply to fog the straight color, then re-apply alpha.
    vec4 tex = texture(u_texture, vec2(v_uv.x, 1.0 - v_uv.y));
    vec3 straight = tex.a > 0.0 ? tex.rgb / tex.a : tex.rgb;
    outColor = vec4(applyFog(straight) * tex.a, tex.a) * u_color.a;
    return;
  }
  vec3 base = u_color.rgb;
  vec3 shaded;
  // Unshaded view (u_debugMode == 1) forces flat albedo even for lit materials.
  if (u_lit > 0.5 && u_debugMode < 0.5) {
    vec3 n = normalize(v_normal);
    float ndl = max(dot(n, -normalize(u_lightDir.xyz)), 0.0);
    shaded = base * (u_ambient.xyz + u_lightColor.xyz * ndl);
  } else {
    shaded = base;
  }
  outColor = vec4(applyFog(shaded) * a, a);
}
