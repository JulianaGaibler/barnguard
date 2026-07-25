#version 300 es
// Stroke fragment, signed-distance-to-segment with round caps (via
// endpoint distance when `along` is outside `[0, segLen]`). AA via a 1-px
// smoothstep on the edge. Dashing: `mod(dashStart + along, period)`
// discards on the dash-off half with a 1-px smoothstep to hide shimmer.
// `dashPeriod == 0` is the no-dash fast path.
precision highp float;

in vec2 v_alongPerp;
flat in float v_segLen;
flat in float v_halfWidth;
flat in float v_dashStart;
flat in float v_dashPeriod;
flat in float v_dashOnLen;
flat in vec4 v_color;

out vec4 fragColor;

void main() {
  float along = v_alongPerp.x;
  float perp = v_alongPerp.y;
  // Distance to segment: endpoint distance in caps, perpendicular otherwise.
  float dist;
  if (along < 0.0) {
    dist = length(vec2(along, perp));
  } else if (along > v_segLen) {
    dist = length(vec2(along - v_segLen, perp));
  } else {
    dist = abs(perp);
  }
  float alpha = 1.0 - smoothstep(v_halfWidth - 0.5, v_halfWidth + 0.5, dist);
  if (alpha <= 0.0) discard;

  if (v_dashPeriod > 0.0) {
    float dashAlong = clamp(along, 0.0, v_segLen);
    float phase = mod(v_dashStart + dashAlong, v_dashPeriod);
    // Fade-in over 1 px at the transition; keeps dashes stable under zoom.
    float off = smoothstep(v_dashOnLen - 0.5, v_dashOnLen + 0.5, phase);
    alpha *= (1.0 - off);
    if (alpha <= 0.0) discard;
  }
  // v_color is premultiplied; final result stays premultiplied by scaling
  // via a linear coverage alpha.
  fragColor = v_color * alpha;
}
