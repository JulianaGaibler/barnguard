#version 300 es
// Instanced textured-quad vertex. One 6-vertex unit-quad template
// (a_unit ∈ [0,1]²), one per-instance record: dst rect in device pixels,
// srcRect in UV space, tint in premultiplied 0..1 RGBA.
precision highp float;

in vec2 a_unit;

in vec4 a_dst;
in vec4 a_srcRect;
in vec4 a_tint;

uniform mat3 u_proj;

out vec2 v_uv;
out vec4 v_tint;

void main() {
  vec2 pos = a_dst.xy + a_dst.zw * a_unit;
  vec3 clip = u_proj * vec3(pos, 1.0);
  gl_Position = vec4(clip.xy, 0.0, 1.0);
  v_uv = mix(a_srcRect.xy, a_srcRect.zw, a_unit);
  v_tint = a_tint;
}
