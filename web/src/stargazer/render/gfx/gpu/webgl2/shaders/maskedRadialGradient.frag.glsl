#version 300 es
// Masked radial-gradient fragment. Output = (world-fixed radial gradient) ×
// (mask silhouette alpha) × instance alpha. `u_stops` is the same premultiplied
// 256×1 LUT the plain radial gradient uses (cached by stops-array identity);
// `u_mask` is the cloud silhouette texture (alpha channel is the mask).
precision highp float;

in vec2 v_uv;
in vec2 v_pos;
flat in vec4 v_grad;

uniform sampler2D u_mask;
uniform sampler2D u_stops;

out vec4 fragColor;

void main() {
  float maskA = texture(u_mask, v_uv).a;
  float radius = max(v_grad.z, 1e-4);
  float t = clamp(distance(v_pos, v_grad.xy) / radius, 0.0, 1.0);
  // LUT is premultiplied; multiplying by mask alpha + instance alpha keeps that.
  vec4 grad = texture(u_stops, vec2(t, 0.5));
  fragColor = grad * (maskA * v_grad.w);
}
