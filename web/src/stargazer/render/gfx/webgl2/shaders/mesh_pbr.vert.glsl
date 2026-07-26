#version 300 es
// Metallic-roughness PBR vertex stage. Positions go to world space (for the
// per-fragment view vector and derivative tangent frame) and then to clip
// space. The world-space normal uses u_normalMatrix (inverse-transpose of the
// model 3x3) so non-uniform scale doesn't skew it. a_tangent is the glTF
// TANGENT (xyz + handedness in w); meshes without it leave the attribute
// disabled and the fragment stage reconstructs a frame from screen derivatives.

in vec3 a_position;
in vec3 a_normal;
in vec2 a_uv;
in vec4 a_tangent;

uniform mat4 u_model;
uniform mat4 u_viewProj;
uniform mat3 u_normalMatrix;

out vec3 v_worldPos;
out vec3 v_normal;
out vec2 v_uv;
out vec4 v_tangent;

void main() {
  vec4 worldPos = u_model * vec4(a_position, 1.0);
  v_worldPos = worldPos.xyz;
  gl_Position = u_viewProj * worldPos;
  v_normal = u_normalMatrix * a_normal;
  v_tangent = vec4(u_normalMatrix * a_tangent.xyz, a_tangent.w);
  v_uv = a_uv;
}
