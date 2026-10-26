// The fullscreen vertex the drawing passes share. The pipeline supplies the
// triangle, with the uv already in the order the backend samples.

struct VertexOut {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

@vertex
fn vs_main(
  @location(0) a_pos: vec2<f32>,
  @location(1) a_uv: vec2<f32>,
) -> VertexOut {
  var out: VertexOut;
  out.uv = a_uv;
  out.position = vec4<f32>(a_pos, 0.0, 1.0);
  return out;
}
