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

// Per-run debug/clip params, std140 block (see DRAWPARAMS_UBO_BINDING). Ints are
// carried as floats so the block is a plain vec4 + 4 floats (no int/float mixing
// in std140 staging).
layout(std140) uniform DrawParams {
  vec4 u_debugColor;   // premultiplied hue for batch-color mode
  float u_clipEnabled; // 1.0 when a clip mask is bound
  float u_debugMode;   // 0 normal, 1 overdraw, 2 batch-color
  vec2 _drawParamsPad;
};

out vec4 fragColor;

void main() {
  vec4 c = v_color;
  if (u_clipEnabled > 0.5) {
    c *= texture(u_clipTex, v_uv).a;
  }
  int mode = int(u_debugMode + 0.5);
  if (mode == 1) {
    // Small premultiplied red per fragment. `lighter` blend at the
    // batch level turns this into an accumulating heatmap.
    c = vec4(0.05, 0.0, 0.0, 0.05);
  } else if (mode == 2) {
    c = u_debugColor;
  }
  fragColor = c;
}
