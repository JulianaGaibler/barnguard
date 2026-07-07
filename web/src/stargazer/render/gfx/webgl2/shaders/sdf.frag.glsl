#version 300 es
// SDF-shape fragment, computes distance from fragment to circle center,
// composites a filled disc (`fillAlpha`) and an optional ring stroke
// (`strokeAlpha`) using premultiplied source-over. Dashing on the ring
// uses angle-around-center × radius as the arc-length coordinate; the
// sign of `dashPeriod` encodes "no dash" (negative → skip the mask).
precision highp float;

in vec2 v_worldPos;
flat in vec2 v_center;
flat in float v_radius;
flat in float v_strokeWidth;
flat in vec4 v_colorFill;
flat in vec4 v_colorStroke;
flat in vec2 v_dash;

out vec4 fragColor;

void main() {
  vec2 delta = v_worldPos - v_center;
  float dist = length(delta);

  // Fill: full inside r, smooth to 0 across the last 1 px.
  float fillAlpha = 1.0 - smoothstep(v_radius - 0.5, v_radius + 0.5, dist);
  vec4 fill = v_colorFill * fillAlpha;

  // Stroke ring: high where |dist - radius| < strokeWidth/2.
  vec4 stroke = vec4(0.0);
  if (v_strokeWidth > 0.0) {
    float strokeHalf = v_strokeWidth * 0.5;
    float outer = v_radius + strokeHalf;
    float inner = v_radius - strokeHalf;
    float outerEdge = 1.0 - smoothstep(outer - 0.5, outer + 0.5, dist);
    float innerEdge = smoothstep(inner - 0.5, inner + 0.5, dist);
    float strokeAlpha = outerEdge * innerEdge;

    // Dashing on the ring, arc-length phase.
    float dashPeriod = v_dash.y;
    if (dashPeriod > 0.0 && strokeAlpha > 0.0) {
      float dashStart = v_dash.x;
      float dashOnLen = dashPeriod * 0.5;
      float angle = atan(delta.y, delta.x);
      // Wrap to [0, 2π) then convert to arc length at the ring's centerline.
      float TWO_PI = 6.28318530718;
      float wrap = angle < 0.0 ? angle + TWO_PI : angle;
      float arcPos = wrap * v_radius;
      float phase = mod(dashStart + arcPos, dashPeriod);
      float off = smoothstep(dashOnLen - 0.5, dashOnLen + 0.5, phase);
      strokeAlpha *= (1.0 - off);
    }
    stroke = v_colorStroke * strokeAlpha;
  }

  // Source-over: stroke over fill. Both premultiplied.
  fragColor = stroke + fill * (1.0 - stroke.a);
  if (fragColor.a <= 0.0) discard;
}
