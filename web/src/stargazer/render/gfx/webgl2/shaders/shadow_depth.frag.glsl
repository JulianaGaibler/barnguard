#version 300 es
precision highp float;
// Depth-only: the shadow framebuffer has no color attachment, so the fragment
// stage produces no output — only the interpolated depth is written.

void main() {}
