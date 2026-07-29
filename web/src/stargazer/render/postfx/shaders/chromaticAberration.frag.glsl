#version 300 es
precision highp float;
// Chromatic aberration: split the RGB channels along a radial offset that grows
// toward the edges (scaled by r² from center), mimicking a lens's transverse
// color error. The frame is premultiplied-alpha; shifting channels by different
// UVs would decouple color from alpha and could leave rgb > a (an invalid
// premultiplied state that composites as additive fringing over the page). To
// stay valid the output alpha is the max of the three taps' alphas, which
// guarantees rgb ≤ a.

in vec2 v_uv;
uniform sampler2D u_tex;

// Per-pass params, std140 block (see POST_PARAMS_UBO_BINDING).
// x = amount (peak channel separation in uv units at the corners).
layout(std140) uniform Params {
  vec4 u_ca;
};

out vec4 outColor;

void main() {
  float u_amount = u_ca.x;
  vec2 dir = (v_uv - 0.5) * u_amount * dot(v_uv - 0.5, v_uv - 0.5);
  vec4 rC = texture(u_tex, v_uv - dir);
  vec4 gC = texture(u_tex, v_uv);
  vec4 bC = texture(u_tex, v_uv + dir);
  outColor = vec4(rC.r, gC.g, bC.b, max(rC.a, max(gC.a, bC.a)));
}
