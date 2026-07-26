#version 300 es
// Shape-program vertex. One instanced unit quad covers three shape families
// selected by `a_shape.x` (shapeType): textured (text + atlas sprites), circle
// SDF, and rounded-box SDF. Each branch positions the quad for its family in
// device px. Projection is the shared per-frame block.
precision highp float;

in vec2 a_unit;         // per-vertex template ([0,1]²)

in vec2 a_mCol0;        // per-instance affine column 0 (device px)
in vec2 a_mCol1;        // per-instance affine column 1 (device px)
in vec2 a_mTranslate;   // per-instance affine translate (device px)
in vec4 a_shape;        // (shapeType, feather, texIndex, pad)
in vec4 a_params;       // circle (radius, stroke, dashStart, dashPeriod) / rrect (halfW, halfH, stroke, _)
in vec4 a_radii;        // round-rect corner radii (tl, tr, br, bl) local
in vec4 a_srcRect;      // textured (u0, v0, u1, v1)
in vec4 a_colorFill;    // premultiplied RGBA
in vec4 a_colorStroke;  // premultiplied RGBA

layout(std140) uniform Frame {
  mat3 u_proj;
};

flat out int v_shapeType;
flat out float v_texIndex;
out vec2 v_uv;           // textured
out vec4 v_tint;         // textured
out vec2 v_worldPos;     // circle (device px)
flat out vec2 v_center;  // circle
flat out float v_radius; // circle
flat out vec2 v_dash;    // circle (dashStart, dashPeriod)
out vec2 v_local;        // round-rect (centered local)
flat out vec2 v_half;    // round-rect half extents
flat out vec4 v_radii;   // round-rect radii
flat out float v_strokeWidth; // circle + round-rect
flat out vec4 v_colorFill;
flat out vec4 v_colorStroke;

void main() {
  int shape = int(a_shape.x + 0.5);
  v_shapeType = shape;
  v_texIndex = a_shape.z;
  v_colorFill = a_colorFill;
  v_colorStroke = a_colorStroke;

  vec2 pos;
  if (shape == 1) {
    // Circle: center + (unit-0.5)*2*outerRadius.
    vec2 center = a_mTranslate;
    float radius = a_params.x;
    float strokeWidth = a_params.y;
    float outerRadius = radius + strokeWidth * 0.5 + 1.0;
    pos = center + (a_unit - 0.5) * 2.0 * outerRadius;
    v_worldPos = pos;
    v_center = center;
    v_radius = radius;
    v_strokeWidth = strokeWidth;
    v_dash = a_params.zw;
  } else if (shape == 2) {
    // Round-rect: local centered space + affine.
    vec2 halfExt = a_params.xy;
    float feather = a_shape.y;
    vec2 local = (a_unit - 0.5) * 2.0 * (halfExt + feather);
    pos = a_mTranslate + a_mCol0 * local.x + a_mCol1 * local.y;
    v_local = local;
    v_half = halfExt;
    v_radii = a_radii;
    v_strokeWidth = a_params.z;
  } else {
    // Textured: affine quad, sample srcRect × tint.
    pos = a_mCol0 * a_unit.x + a_mCol1 * a_unit.y + a_mTranslate;
    v_uv = mix(a_srcRect.xy, a_srcRect.zw, a_unit);
    v_tint = a_colorFill;
  }

  vec3 clip = u_proj * vec3(pos, 1.0);
  gl_Position = vec4(clip.xy, 0.0, 1.0);
}
