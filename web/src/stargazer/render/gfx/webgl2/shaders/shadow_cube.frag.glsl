#version 300 es
precision highp float;
// Store linear distance from the light, normalized to [0,1] by the far range,
// so the main shader compares against the same distance metric. Writing
// gl_FragDepth disables early-Z, which is fine for six small cube faces.

in vec3 v_worldPos;

uniform vec4 u_lightPos; // xyz world position
uniform float u_far;

void main() {
  gl_FragDepth = clamp(length(v_worldPos - u_lightPos.xyz) / u_far, 0.0, 1.0);
}
