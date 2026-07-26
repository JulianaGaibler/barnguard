#version 300 es
// Retained colored-fill fragment shader. Flat premultiplied color from a
// per-draw uniform (the streamed path bakes the color per vertex; retained
// moves it to a uniform since every vertex shares it).
precision highp float;

uniform vec4 u_color;

out vec4 outColor;

void main() {
  outColor = u_color;
}
