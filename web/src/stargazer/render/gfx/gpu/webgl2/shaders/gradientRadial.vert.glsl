#version 300 es
// Radial-gradient vertex, positions a quad centered on the gradient's
// origin, size = 2·radius. Passes normalized `v_uv ∈ [0,1]²` for the
// fragment to compute `t = length(v_uv - 0.5) * 2` and sample the
// `u_stops` 1D LUT texture.
precision highp float;

in vec2 a_unit;         // per-vertex template ([0,1]²)

in vec2 a_center;       // per-instance center (device px)
in vec2 a_radAlpha;     // per-instance (radius, alpha)

uniform mat3 u_proj;

out vec2 v_uv;
flat out float v_alpha;

void main() {
  float radius = a_radAlpha.x;
  vec2 pos = a_center + (a_unit - 0.5) * 2.0 * radius;
  vec3 clip = u_proj * vec3(pos, 1.0);
  gl_Position = vec4(clip.xy, 0.0, 1.0);
  v_uv = a_unit;
  v_alpha = a_radAlpha.y;
}
