#version 300 es
precision highp float;
// Vignette: darken toward the edges by a smooth radial falloff. Multiplying a
// premultiplied pixel by a scalar scales color and alpha together, so the
// result stays a valid premultiplied color and composites correctly.

in vec2 v_uv;
uniform sampler2D u_tex;

// Per-pass params, std140 block (see POST_PARAMS_UBO_BINDING).
// x = intensity (0 = off, 1 = corners black), y = radius, z = softness.
layout(std140) uniform Params {
  vec4 u_vig;
};

out vec4 outColor;

void main() {
  vec4 src = texture(u_tex, v_uv);
  float d = distance(v_uv, vec2(0.5));
  float v = 1.0 - u_vig.x * smoothstep(u_vig.y, u_vig.y + u_vig.z, d);
  outColor = src * v;
}
