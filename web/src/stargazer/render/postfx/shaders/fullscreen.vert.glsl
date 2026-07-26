#version 300 es
// Shared post-processing vertex stage. Draws a single oversized clip-space
// triangle (a_pos = [-1,-1], [3,-1], [-1,3]) covering the whole viewport; the
// off-screen corners are clipped away. v_uv maps clip space to [0,1] texture
// space. No y-flip: the source render, the resolve, every ping-pong pass, and
// the final blit all share the bottom-left FBO origin, so the image stays
// upright end to end.

in vec2 a_pos;

out vec2 v_uv;

void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
