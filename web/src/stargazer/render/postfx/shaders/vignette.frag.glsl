#version 300 es
precision highp float;
// Vignette: darken toward the edges by a smooth radial falloff. Multiplying a
// premultiplied pixel by a scalar scales color and alpha together, so the
// result stays a valid premultiplied color and composites correctly.

in vec2 v_uv;
uniform sampler2D u_tex;
uniform float u_intensity; // 0 = off, 1 = corners fully black
uniform float u_radius;    // distance from center where darkening begins
uniform float u_softness;  // width of the falloff band

out vec4 outColor;

void main() {
  vec4 src = texture(u_tex, v_uv);
  float d = distance(v_uv, vec2(0.5));
  float v = 1.0 - u_intensity * smoothstep(u_radius, u_radius + u_softness, d);
  outColor = src * v;
}
