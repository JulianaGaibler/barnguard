#version 300 es
// Retained colored-fill vertex shader. Positions arrive in the geometry's own
// local space (uploaded once to a static buffer); the per-draw model matrix
// places them, so the CPU never re-transforms vertices. Projection is the
// shared per-frame Frame block.
precision highp float;

in vec2 a_pos;

// Per-frame projection matrix, shared std140 block (see FRAME_UBO_BINDING).
layout(std140) uniform Frame {
  mat3 u_proj;
};

// Per-draw world matrix (the captured transform stack) as a 2D affine mat3.
uniform mat3 u_model;

void main() {
  vec3 world = u_model * vec3(a_pos, 1.0);
  vec3 clip = u_proj * vec3(world.xy, 1.0);
  gl_Position = vec4(clip.xy, 0.0, 1.0);
}
