#version 300 es
// Retained colored-fill fragment shader. Flat premultiplied color from a
// per-draw uniform (the streamed path bakes the color per vertex; retained
// moves it to a uniform since every vertex shares it).
precision highp float;

// Per-draw model matrix + flat color, std140 block (see MODELCOLOR_UBO_BINDING).
// Matches the block declared in the vertex stage; the fragment stage reads only
// `u_color`.
layout(std140) uniform ModelColor {
  mat3 u_model;
  vec4 u_color;
};

out vec4 outColor;

void main() {
  outColor = u_color;
}
