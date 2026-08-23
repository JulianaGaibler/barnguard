#version 300 es

precision highp float;
precision highp int;

struct Frame {
    mat3x3 proj;
    float targetH;
    float fragYFlip;
};
struct Clip {
    float kind;
    float cx;
    float cy;
    float r;
    float halfW;
    float halfH;
    float rrRadius;
    float clipPad;
};
struct VOut {
    vec4 pos;
    int shapeType;
    float texIndex;
    vec2 uv;
    vec4 tint;
    vec2 worldPos;
    vec2 center;
    float radius;
    vec2 dash;
    vec2 local;
    vec2 halfExt;
    vec4 radii;
    float strokeWidth;
    vec4 colorFill;
    vec4 colorStroke;
};
layout(std140) uniform Frame_block_0Vertex { Frame _group_0_binding_0_vs; };

layout(location = 0) in vec2 _p2vs_location0;
layout(location = 1) in vec2 _p2vs_location1;
layout(location = 2) in vec2 _p2vs_location2;
layout(location = 3) in vec2 _p2vs_location3;
layout(location = 4) in vec4 _p2vs_location4;
layout(location = 5) in vec4 _p2vs_location5;
layout(location = 6) in vec4 _p2vs_location6;
layout(location = 7) in vec4 _p2vs_location7;
layout(location = 8) in vec4 _p2vs_location8;
layout(location = 9) in vec4 _p2vs_location9;
flat out int _vs2fs_location0;
flat out float _vs2fs_location1;
smooth out vec2 _vs2fs_location2;
smooth out vec4 _vs2fs_location3;
smooth out vec2 _vs2fs_location4;
flat out vec2 _vs2fs_location5;
flat out float _vs2fs_location6;
flat out vec2 _vs2fs_location7;
smooth out vec2 _vs2fs_location8;
flat out vec2 _vs2fs_location9;
flat out vec4 _vs2fs_location10;
flat out float _vs2fs_location11;
flat out vec4 _vs2fs_location12;
flat out vec4 _vs2fs_location13;

float clipRoundBox(vec2 p_1, vec2 b, float rad) {
    vec2 q = ((abs(p_1) - b) + vec2(rad));
    return ((min(max(q.x, q.y), 0.0) + length(max(q, vec2(0.0)))) - rad);
}

float sdRoundBox(vec2 p_2, vec2 b_1, vec4 r) {
    vec2 rr = ((p_2.x > 0.0) ? r.yz : r.xw);
    float radius = ((p_2.y > 0.0) ? rr.y : rr.x);
    vec2 q_1 = ((abs(p_2) - b_1) + vec2(radius));
    return ((min(max(q_1.x, q_1.y), 0.0) + length(max(q_1, vec2(0.0)))) - radius);
}

void main() {
    vec2 a_unit = _p2vs_location0;
    vec2 a_mCol0_ = _p2vs_location1;
    vec2 a_mCol1_ = _p2vs_location2;
    vec2 a_mTranslate = _p2vs_location3;
    vec4 a_shape = _p2vs_location4;
    vec4 a_params = _p2vs_location5;
    vec4 a_radii = _p2vs_location6;
    vec4 a_srcRect = _p2vs_location7;
    vec4 a_colorFill = _p2vs_location8;
    vec4 a_colorStroke = _p2vs_location9;
    VOut out_ = VOut(vec4(0.0), 0, 0.0, vec2(0.0), vec4(0.0), vec2(0.0), vec2(0.0), 0.0, vec2(0.0), vec2(0.0), vec2(0.0), vec4(0.0), 0.0, vec4(0.0), vec4(0.0));
    vec2 p = vec2(0.0);
    int shape = int((a_shape.x + 0.5));
    out_.shapeType = shape;
    out_.texIndex = a_shape.z;
    out_.colorFill = a_colorFill;
    out_.colorStroke = a_colorStroke;
    if ((shape == 1)) {
        float radius_1 = a_params.x;
        float strokeWidth = a_params.y;
        float outerRadius = ((radius_1 + (strokeWidth * 0.5)) + 1.0);
        p = (a_mTranslate + (((a_unit - vec2(0.5)) * 2.0) * outerRadius));
        vec2 _e38 = p;
        out_.worldPos = _e38;
        out_.center = a_mTranslate;
        out_.radius = radius_1;
        out_.strokeWidth = strokeWidth;
        out_.dash = a_params.zw;
    } else {
        if ((shape == 2)) {
            vec2 halfExt = a_params.xy;
            float feather = a_shape.y;
            vec2 local_1 = (((a_unit - vec2(0.5)) * 2.0) * (halfExt + vec2(feather)));
            p = ((a_mTranslate + (a_mCol0_ * local_1.x)) + (a_mCol1_ * local_1.y));
            out_.local = local_1;
            out_.halfExt = halfExt;
            out_.radii = a_radii;
            out_.strokeWidth = a_params.z;
        } else {
            p = (((a_mCol0_ * a_unit.x) + (a_mCol1_ * a_unit.y)) + a_mTranslate);
            out_.uv = mix(a_srcRect.xy, a_srcRect.zw, a_unit);
            out_.tint = a_colorFill;
        }
    }
    mat3x3 _e80 = _group_0_binding_0_vs.proj;
    vec2 _e81 = p;
    vec3 clip = (_e80 * vec3(_e81, 1.0));
    out_.pos = vec4(clip.xy, 0.0, 1.0);
    VOut _e90 = out_;
    gl_Position = _e90.pos;
    _vs2fs_location0 = _e90.shapeType;
    _vs2fs_location1 = _e90.texIndex;
    _vs2fs_location2 = _e90.uv;
    _vs2fs_location3 = _e90.tint;
    _vs2fs_location4 = _e90.worldPos;
    _vs2fs_location5 = _e90.center;
    _vs2fs_location6 = _e90.radius;
    _vs2fs_location7 = _e90.dash;
    _vs2fs_location8 = _e90.local;
    _vs2fs_location9 = _e90.halfExt;
    _vs2fs_location10 = _e90.radii;
    _vs2fs_location11 = _e90.strokeWidth;
    _vs2fs_location12 = _e90.colorFill;
    _vs2fs_location13 = _e90.colorStroke;
    return;
}

