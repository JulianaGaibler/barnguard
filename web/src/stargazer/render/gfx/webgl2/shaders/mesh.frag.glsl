#version 300 es
precision highp float;
// 3D mesh fragment stage. `u_lit` selects flat unlit color or a single
// directional light plus ambient. `u_useTexture` swaps in a sampled texture
// (a Viewport2DNode's rendered 2D surface), V-flipped from the y-down 2D content
// to the y-up sample space, and taken as already-premultiplied. Output is
// premultiplied alpha to match the engine's premultiplied framebuffer.

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

out vec4 outColor;

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
    outColor = texture(u_texture, vec2(v_uv.x, 1.0 - v_uv.y)) * u_color.a;
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
  outColor = vec4(shaded * a, a);
}
