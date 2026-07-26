#version 300 es
// Depth-only shadow caster: transform positions into the light's clip space.
// Bound during the shadow pre-pass; the framebuffer has only a depth attachment,
// so the fragment stage writes nothing.

in vec3 a_position;

uniform mat4 u_model;
uniform mat4 u_shadowViewProj;

void main() {
  gl_Position = u_shadowViewProj * u_model * vec4(a_position, 1.0);
}
