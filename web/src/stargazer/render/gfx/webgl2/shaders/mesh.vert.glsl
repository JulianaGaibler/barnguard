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

// Per-frame block (see CAMERA3D_UBO_BINDING). Declared identically in the
// fragment stage; the vertex stage only reads `u_viewProj`.
layout(std140) uniform FlatFrame {
  mat4 u_viewProj;
  vec4 u_eyePos;
  vec4 u_ambient;
  vec4 u_fogColor;
  vec4 u_fogParams;
  vec4 u_lightDir;
  vec4 u_lightColor;
  vec4 u_debug; // x = debug mode
};

// Per-object block, std140 (dynamic-offset ring). `u_flags.x` = lit,
// `u_flags.y` = useTexture.
layout(std140) uniform FlatObject {
  mat4 u_model;
  vec4 u_color;
  vec4 u_flags;
};

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
