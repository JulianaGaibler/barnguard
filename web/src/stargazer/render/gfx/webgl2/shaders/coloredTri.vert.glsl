#version 300 es
// Colored-triangle vertex shader (Phase 1). Positions arrive in device pixels
// (CPU-transformed by GpuGfx before append), so the vertex program is trivial:
// project device-px → clip space with a Y-flipping ortho matrix.
precision highp float;

in vec2 a_pos;
in vec4 a_color;
in vec2 a_uv;

uniform mat3 u_proj;

out vec4 v_color;
out vec2 v_uv;

void main() {
  vec3 clip = u_proj * vec3(a_pos, 1.0);
  gl_Position = vec4(clip.xy, 0.0, 1.0);
  v_color = a_color;
  v_uv = a_uv;
}
