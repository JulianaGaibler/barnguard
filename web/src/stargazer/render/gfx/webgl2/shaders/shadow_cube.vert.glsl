#version 300 es
// Point-light shadow caster: one cube face per pass. Passes world position to
// the fragment stage, which writes linear distance-to-light as depth.

in vec3 a_position;

// Light-space view-projection + point-light position/range, std140 block
// (updated per cube face). `u_lightPos.xyz` world position, `u_far.x` range.
layout(std140) uniform CubeCam {
  mat4 u_shadowViewProj;
  vec4 u_lightPos;
  vec4 u_far;
};

// Per-caster model matrix, std140 block (dynamic-offset ring).
layout(std140) uniform ShadowObject {
  mat4 u_model;
};

out vec3 v_worldPos;

void main() {
  vec4 worldPos = u_model * vec4(a_position, 1.0);
  v_worldPos = worldPos.xyz;
  gl_Position = u_shadowViewProj * worldPos;
}
