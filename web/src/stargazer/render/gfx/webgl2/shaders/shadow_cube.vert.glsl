#version 300 es
// Point-light shadow caster: one cube face per pass. Passes world position to
// the fragment stage, which writes linear distance-to-light as depth.

in vec3 a_position;

uniform mat4 u_model;
uniform mat4 u_shadowViewProj;

out vec3 v_worldPos;

void main() {
  vec4 worldPos = u_model * vec4(a_position, 1.0);
  v_worldPos = worldPos.xyz;
  gl_Position = u_shadowViewProj * worldPos;
}
