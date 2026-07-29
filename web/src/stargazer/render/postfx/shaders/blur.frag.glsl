#version 300 es
precision highp float;
// One axis of a separable 5-tap Gaussian blur, run twice (horizontal then
// vertical) by the VignetteBlur effect. The blur step scales with radial
// distance — zero at the center (image stays sharp), maximal at the edges — for
// a focus/lens look. u_dir is the per-texel axis (texelW,0) or (0,texelH).
//
// Note: this blurs sRGB-encoded (not light-linear) values, which darkens the
// result slightly ("dark energy"). Accepted here as a cheap stylistic edge
// blur; a correct linear blur would need un-premultiply → linearize → blur →
// encode → re-premultiply, far too costly for this pass. The unit-weight sum of
// premultiplied samples keeps the premultiplied color valid.

in vec2 v_uv;
uniform sampler2D u_tex;

// Per-pass params, std140 block (see POST_PARAMS_UBO_BINDING).
// u_p0 = (dirX, dirY, radius, softness); u_p1.x = strength (texels at edge).
layout(std140) uniform Params {
  vec4 u_p0;
  vec4 u_p1;
};

// Normalized 5-tap Gaussian: 0.375 + 2·0.25 + 2·0.0625 = 1.0 (no brightening).
const float W0 = 0.375;
const float W1 = 0.25;
const float W2 = 0.0625;

out vec4 outColor;

void main() {
  vec2 u_dir = u_p0.xy;
  float u_radius = u_p0.z;
  float u_softness = u_p0.w;
  float u_strength = u_p1.x;
  float d = distance(v_uv, vec2(0.5));
  float amt = smoothstep(u_radius, u_radius + u_softness, d);
  vec2 off = u_dir * (u_strength * amt);
  vec4 sum = texture(u_tex, v_uv) * W0;
  sum += (texture(u_tex, v_uv + off) + texture(u_tex, v_uv - off)) * W1;
  sum += (texture(u_tex, v_uv + off * 2.0) + texture(u_tex, v_uv - off * 2.0)) * W2;
  outColor = sum;
}
