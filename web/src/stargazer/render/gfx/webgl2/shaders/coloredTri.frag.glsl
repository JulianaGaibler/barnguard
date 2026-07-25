#version 300 es
// Colored-triangle fragment (Phase 1 + 4.6 clip + 4.7 debug modes).
//
// Normal path: writes premultiplied per-vertex color, optionally modulated
// by a bitmap clip mask sampled at `v_uv`.
//
// Debug modes (toggled from the HUD via `GpuGfx.setDebugRenderMode`):
//   1 = overdraw, output a constant dim premultiplied red; combined
//       with the batch's forced-additive blend this accumulates as a
//       heatmap of drawn pixels.
//   2 = batch-color, output `u_debugColor` (a distinct hue per batch,
//       assigned CPU-side at flush time).
//
// The `discard`-based hard-cut clip variant is deliberately avoided
// throughout, `discard` runs once per pixel and would defeat the
// MSAA coverage AA on the polygon edge (Phase 4.5).
precision highp float;

in vec4 v_color;
in vec2 v_uv;

uniform sampler2D u_clipTex;
uniform int u_clipEnabled;
uniform int u_debugMode;
uniform vec4 u_debugColor;

out vec4 fragColor;

void main() {
  vec4 c = v_color;
  if (u_clipEnabled == 1) {
    c *= texture(u_clipTex, v_uv).a;
  }
  if (u_debugMode == 1) {
    // Small premultiplied red per fragment. `lighter` blend at the
    // batch level turns this into an accumulating heatmap.
    c = vec4(0.05, 0.0, 0.0, 0.05);
  } else if (u_debugMode == 2) {
    c = u_debugColor;
  }
  fragColor = c;
}
