#version 300 es
// SDF-shape vertex, one program covers filled circles, rings (dashed +
// solid), and disc+ring composites. Per-instance `strokeWidth == 0` →
// pure fill; `> 0` → ring on top of (optionally transparent) fill.
// `dashPeriod` sign bit: negative = no dash; positive = arc-length dash.
precision highp float;

in vec2 a_unit;             // per-vertex template ([0,1]²)

in vec2 a_center;           // per-instance center (device px)
in vec2 a_radStroke;        // per-instance (radius, strokeWidth)
in vec4 a_colorFill;        // per-instance premultiplied RGBA
in vec4 a_colorStroke;      // per-instance premultiplied RGBA
in vec2 a_dash;             // per-instance (dashStart, dashPeriod)

uniform mat3 u_proj;

out vec2 v_worldPos;        // interpolated fragment position (device px)
flat out vec2 v_center;
flat out float v_radius;
flat out float v_strokeWidth;
flat out vec4 v_colorFill;
flat out vec4 v_colorStroke;
flat out vec2 v_dash;

void main() {
  float outerRadius = a_radStroke.x + a_radStroke.y * 0.5 + 1.0;
  // Position: center + (unit-0.5) * 2 * outerRadius.
  vec2 pos = a_center + (a_unit - 0.5) * 2.0 * outerRadius;
  vec3 clip = u_proj * vec3(pos, 1.0);
  gl_Position = vec4(clip.xy, 0.0, 1.0);
  v_worldPos = pos;
  v_center = a_center;
  v_radius = a_radStroke.x;
  v_strokeWidth = a_radStroke.y;
  v_colorFill = a_colorFill;
  v_colorStroke = a_colorStroke;
  v_dash = a_dash;
}
