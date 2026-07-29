#version 300 es
// Debug gizmo line vertex stage. World-space endpoints projected by the 3D
// camera's view-projection; per-vertex color passes through to the fragment
// stage. Drawn as GL_LINES.

in vec3 a_position;
in vec4 a_color;

// View-projection, std140 block (see CAMERA3D_UBO_BINDING).
layout(std140) uniform DebugCam {
  mat4 u_viewProj;
};

out vec4 v_color;

void main() {
  gl_Position = u_viewProj * vec4(a_position, 1.0);
  v_color = a_color;
}
