#version 300 es
// 3D mesh vertex stage. Positions are transformed by the per-object model matrix
// into world space, then by the camera view-projection into clip space. The
// world-space normal (via the model's upper 3x3) goes to the fragment stage for
// lighting; non-uniform scale skews it, uniform scale and rotation are exact.
// The world position also passes through for the fragment stage's distance fog.
// a_uv feeds textured quads (Viewport2DNode); plain meshes leave it disabled.

in vec3 a_position;
in vec3 a_normal;
in vec2 a_uv;

uniform mat4 u_model;
uniform mat4 u_viewProj;

out vec3 v_worldPos;
out vec3 v_normal;
out vec2 v_uv;

void main() {
  vec4 worldPos = u_model * vec4(a_position, 1.0);
  v_worldPos = worldPos.xyz;
  gl_Position = u_viewProj * worldPos;
  v_normal = mat3(u_model) * a_normal;
  v_uv = a_uv;
}
