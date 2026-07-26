#version 300 es
// Instanced textured-quad fragment (Phase 1). Sample the bound texture at
// the interpolated UV and multiply by the instance tint. Both texture texels
// and tint are premultiplied, the multiply keeps that invariant.
precision highp float;

in vec2 v_uv;
in vec4 v_tint;

uniform sampler2D u_tex;

out vec4 fragColor;

void main() {
  fragColor = texture(u_tex, v_uv) * v_tint;
}
