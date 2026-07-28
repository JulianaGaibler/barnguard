#version 300 es
// Metallic-roughness PBR vertex stage. Positions go to world space (for the
// per-fragment view vector and derivative tangent frame) and then to clip
// space. The world-space normal uses u_normalMatrix (inverse-transpose of the
// model 3x3, stored as a mat4 for std140 simplicity) so non-uniform scale
// doesn't skew it. a_tangent is the glTF TANGENT (xyz + handedness in w).

in vec3 a_position;
in vec3 a_normal;
in vec2 a_uv;
in vec4 a_tangent;

// Per-frame block (see CAMERA3D_UBO_BINDING). The vertex stage reads only
// `u_viewProj`; declared identically in the fragment stage.
layout(std140) uniform PbrFrame {
  mat4 u_viewProj;
  vec4 u_eyePos;
  vec4 u_ambient;
  vec4 u_fogColor;
  vec4 u_fogParams;
  vec4 u_debug; // x = debug mode
};

// Per-object block, std140 (dynamic-offset ring). `u_normalMatrix` is a mat4
// (only its upper 3x3 is used) to avoid std140 mat3 column padding.
layout(std140) uniform PbrObject {
  mat4 u_model;
  mat4 u_normalMatrix;
  vec4 u_baseColorFactor;
  vec4 u_emissiveFactor;
  vec4 u_matParams0; // metallic, roughness, occlusionStrength, normalScale
  vec4 u_matParams1; // alphaCutoff, diffuseTransmission, hasTangent, alphaMode
  vec4 u_hasTex0;    // hasBaseColor, hasMetalRough, hasNormal, hasOcclusion
  vec4 u_hasTex1;    // hasEmissive, hasDiffTrans, _, _
};

out vec3 v_worldPos;
out vec3 v_normal;
out vec2 v_uv;
out vec4 v_tangent;

void main() {
  vec4 worldPos = u_model * vec4(a_position, 1.0);
  v_worldPos = worldPos.xyz;
  gl_Position = u_viewProj * worldPos;
  mat3 nm = mat3(u_normalMatrix);
  v_normal = nm * a_normal;
  v_tangent = vec4(nm * a_tangent.xyz, a_tangent.w);
  v_uv = a_uv;
}
