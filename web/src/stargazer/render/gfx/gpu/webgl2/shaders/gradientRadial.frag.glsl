#version 300 es
// Radial-gradient fragment, samples `u_stops` (1D LUT, 256×1 RGBA8,
// premultiplied) at `t = length(uv - 0.5) * 2` clamped to `[0, 1]`.
// `u_stops` is populated on the CPU by rendering the gradient stops into
// an offscreen 1-pixel-tall canvas and cached by stops-array identity.
precision highp float;

in vec2 v_uv;
flat in float v_alpha;

uniform sampler2D u_stops;

out vec4 fragColor;

void main() {
  float t = length(v_uv - 0.5) * 2.0;
  if (t > 1.0) discard;
  // Sample horizontally through the LUT; `y = 0.5` reads the center row
  // of the 1-tall texture.
  vec4 c = texture(u_stops, vec2(t, 0.5));
  fragColor = c * v_alpha;
}
