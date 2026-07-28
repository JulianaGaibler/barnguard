#version 300 es
precision highp float;
// Store linear distance from the light, normalized to [0,1] by the far range,
// so the main shader compares against the same distance metric. Writing
// gl_FragDepth disables early-Z, which is fine for six small cube faces.

in vec3 v_worldPos;

// Light-space view-projection + point-light position/range, std140 block.
// Matches the vertex stage; the fragment stage reads `u_lightPos` + `u_far`.
layout(std140) uniform CubeCam {
  mat4 u_shadowViewProj;
  vec4 u_lightPos;
  vec4 u_far;
};

void main() {
  gl_FragDepth =
    clamp(length(v_worldPos - u_lightPos.xyz) / u_far.x, 0.0, 1.0);
}
