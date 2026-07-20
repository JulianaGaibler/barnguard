#version 300 es
// Masked radial-gradient vertex. Draws one instanced quad (dst rect in device
// px) textured with a mask (alpha silhouette). The gradient is WORLD-FIXED: the
// fragment computes it from the device-space position vs a per-instance center +
// radius, so translating the quad slides the silhouette across a stationary
// gradient. `highp` for the position/distance math (4K-scale device coords
// exceed mediump range).
precision highp float;

in vec2 a_unit;         // per-vertex unit-quad template ([0,1]²)

in vec4 a_dst;          // per-instance dst rect (device px: x, y, w, h)
in vec4 a_srcRect;      // per-instance mask UV rect (u0, v0, u1, v1)
in vec4 a_grad;         // per-instance gradient (centerX, centerY, radius, alpha) device px

uniform mat3 u_proj;

out vec2 v_uv;          // mask UV
out vec2 v_pos;         // device-px fragment position (for the gradient)
flat out vec4 v_grad;

void main() {
  vec2 pos = a_dst.xy + a_dst.zw * a_unit;
  vec3 clip = u_proj * vec3(pos, 1.0);
  gl_Position = vec4(clip.xy, 0.0, 1.0);
  v_uv = mix(a_srcRect.xy, a_srcRect.zw, a_unit);
  v_pos = pos;
  v_grad = a_grad;
}
