#version 300 es
// Depth-only shadow caster: transform positions into the light's clip space.
// Bound during the shadow pre-pass; the framebuffer has only a depth attachment,
// so the fragment stage writes nothing.

in vec3 a_position;

// Light-space view-projection, std140 block (per shadow layer).
layout(std140) uniform ShadowCam {
  mat4 u_shadowViewProj;
};

// Per-caster model matrix, std140 block (dynamic-offset ring).
layout(std140) uniform ShadowObject {
  mat4 u_model;
};

void main() {
  gl_Position = u_shadowViewProj * u_model * vec4(a_position, 1.0);
}
