#version 300 es
precision highp float;
// Debug gizmo line fragment stage. Emits the per-vertex color, premultiplied to
// match the engine's premultiplied framebuffer.

in vec4 v_color;
out vec4 outColor;

void main() {
  outColor = vec4(v_color.rgb * v_color.a, v_color.a);
}
