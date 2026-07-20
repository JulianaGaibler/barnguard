#version 300 es
// Instanced text-quad vertex. Like texturedQuad but the per-instance placement
// is a full 2×3 affine (column vectors + translation) mapping the unit quad
// (a_unit ∈ [0,1]²) to device px, so labels honor rotation/skew from the node
// transform (texturedQuad only carries an axis-aligned rect). Shares
// texturedQuad.frag.glsl (texture × premultiplied tint). `highp` for the
// device-space position math at 4K scale.
precision highp float;

in vec2 a_unit;

in vec2 a_mCol0;       // per-instance: device-px image of unit +x edge
in vec2 a_mCol1;       // per-instance: device-px image of unit +y edge
in vec2 a_mTranslate;  // per-instance: device-px position of unit origin
in vec4 a_srcRect;     // per-instance: src UV rect (u0, v0, u1, v1)
in vec4 a_tint;        // per-instance: premultiplied 0..1 RGBA tint

uniform mat3 u_proj;

out vec2 v_uv;
out vec4 v_tint;

void main() {
  vec2 pos = a_mCol0 * a_unit.x + a_mCol1 * a_unit.y + a_mTranslate;
  vec3 clip = u_proj * vec3(pos, 1.0);
  gl_Position = vec4(clip.xy, 0.0, 1.0);
  v_uv = mix(a_srcRect.xy, a_srcRect.zw, a_unit);
  v_tint = a_tint;
}
