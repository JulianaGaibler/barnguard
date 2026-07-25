#version 300 es
// Shape-program fragment. Branches on shapeType: circle SDF, rounded-box SDF,
// or a textured sample × tint. Textured instances pick a fixed-unit texture via
// texIndex (atlas or label page), so text + sprites + shapes share one
// blend-only batch.
precision highp float;

flat in int v_shapeType;
flat in float v_texIndex;
in vec2 v_uv;
in vec4 v_tint;
in vec2 v_worldPos;
flat in vec2 v_center;
flat in float v_radius;
flat in vec2 v_dash;
in vec2 v_local;
flat in vec2 v_half;
flat in vec4 v_radii;
flat in float v_strokeWidth;
flat in vec4 v_colorFill;
flat in vec4 v_colorStroke;

uniform sampler2D u_texAtlas;
uniform sampler2D u_texLabel;

out vec4 fragColor;

// --- round-box SDF ----------------------------------------------------------
float sdRoundBox(vec2 p, vec2 b, vec4 r) {
  vec2 rr = (p.x > 0.0) ? r.yz : r.xw;
  float radius = (p.y > 0.0) ? rr.y : rr.x;
  vec2 q = abs(p) - b + radius;
  return min(max(q.x, q.y), 0.0) + length(max(q, vec2(0.0))) - radius;
}
float coverage(float d) {
  return clamp(0.5 - d / max(fwidth(d), 1e-4), 0.0, 1.0);
}

void main() {
  if (v_shapeType == 1) {
    // Circle SDF.
    vec2 delta = v_worldPos - v_center;
    float dist = length(delta);
    float fillAlpha = 1.0 - smoothstep(v_radius - 0.5, v_radius + 0.5, dist);
    vec4 fill = v_colorFill * fillAlpha;
    vec4 stroke = vec4(0.0);
    if (v_strokeWidth > 0.0) {
      float strokeHalf = v_strokeWidth * 0.5;
      float outer = v_radius + strokeHalf;
      float inner = v_radius - strokeHalf;
      float outerEdge = 1.0 - smoothstep(outer - 0.5, outer + 0.5, dist);
      float innerEdge = smoothstep(inner - 0.5, inner + 0.5, dist);
      float strokeAlpha = outerEdge * innerEdge;
      float dashPeriod = v_dash.y;
      if (dashPeriod > 0.0 && strokeAlpha > 0.0) {
        float dashStart = v_dash.x;
        float dashOnLen = dashPeriod * 0.5;
        float angle = atan(delta.y, delta.x);
        float TWO_PI = 6.28318530718;
        float wrap = angle < 0.0 ? angle + TWO_PI : angle;
        float arcPos = wrap * v_radius;
        float phase = mod(dashStart + arcPos, dashPeriod);
        float off = smoothstep(dashOnLen - 0.5, dashOnLen + 0.5, phase);
        strokeAlpha *= (1.0 - off);
      }
      stroke = v_colorStroke * strokeAlpha;
    }
    fragColor = stroke + fill * (1.0 - stroke.a);
    if (fragColor.a <= 0.0) discard;
  } else if (v_shapeType == 2) {
    // Round-rect SDF.
    float d = sdRoundBox(v_local, v_half, v_radii);
    vec4 fill = v_colorFill * coverage(d);
    vec4 stroke = vec4(0.0);
    if (v_strokeWidth > 0.0) {
      float sd = abs(d) - v_strokeWidth * 0.5;
      stroke = v_colorStroke * coverage(sd);
    }
    fragColor = stroke + fill * (1.0 - stroke.a);
    if (fragColor.a <= 0.0) discard;
  } else {
    // Textured — sample the fixed-unit texture selected by texIndex × tint.
    // Dynamically-uniform if-chain (GLSL ES 3.00 forbids indexing a sampler
    // array by a non-uniform expression).
    vec4 texel = v_texIndex < 0.5
      ? texture(u_texAtlas, v_uv)
      : texture(u_texLabel, v_uv);
    fragColor = texel * v_tint;
  }
}
