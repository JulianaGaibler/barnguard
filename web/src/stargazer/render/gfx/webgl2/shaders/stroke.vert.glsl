#version 300 es
// Instanced-segment stroke vertex shader (three.js LineMaterial shape).
// One instance per polyline segment; the unit template is 6 verts of a
// [0,1]×[-0.5,+0.5] quad. Positioning extends the quad by (halfWidth + 1 px)
// past each endpoint along the tangent so the fragment shader's round-cap
// AA falls inside the quad without a second draw.
precision highp float;

in vec2 a_unit;         // per-vertex template

in vec2 a_p0;           // per-instance segment start (device px)
in vec2 a_p1;           // per-instance segment end (device px)
in vec4 a_color;        // per-instance premultiplied RGBA
in vec4 a_widthDash;    // (width, dashStart, dashPeriod, dashOnLen)

uniform mat3 u_proj;

out vec2 v_alongPerp;   // (along, perp) in segment-local device px
flat out float v_segLen;
flat out float v_halfWidth;
flat out float v_dashStart;
flat out float v_dashPeriod;
flat out float v_dashOnLen;
flat out vec4 v_color;

void main() {
  vec2 seg = a_p1 - a_p0;
  float segLen = length(seg);
  // Handle degenerate p0==p1 (used for join discs at interior polyline
  // vertices), tangent defaults to +x; the shader's distance test only
  // reads the endpoint case anyway.
  vec2 tangent = segLen > 1e-6 ? seg / segLen : vec2(1.0, 0.0);
  vec2 normal = vec2(-tangent.y, tangent.x);
  float halfWidth = a_widthDash.x * 0.5;
  // Extend the quad by (halfWidth + 1) on all sides for round caps + AA.
  // `a_unit ∈ [0,1]²` (shared with the other instanced quads); map to
  // segment-local: along ∈ [-ext, segLen+ext], perp ∈ [-ext, +ext].
  float ext = halfWidth + 1.0;
  float along = mix(-ext, segLen + ext, a_unit.x);
  float perp = (a_unit.y - 0.5) * 2.0 * ext;
  vec2 pos = a_p0 + tangent * along + normal * perp;
  vec3 clip = u_proj * vec3(pos, 1.0);
  gl_Position = vec4(clip.xy, 0.0, 1.0);
  v_alongPerp = vec2(along, perp);
  v_segLen = segLen;
  v_halfWidth = halfWidth;
  v_dashStart = a_widthDash.y;
  v_dashPeriod = a_widthDash.z;
  v_dashOnLen = a_widthDash.w;
  v_color = a_color;
}
