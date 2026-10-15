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
    float pad0_;
    float pad1_;
    vec4 radii;
};
struct Params {
    vec4 shape;
    vec4 warn;
    vec4 pulse;
};
struct VOut {
    vec4 pos;
    vec2 uv;
    float alpha;
};
layout(std140) uniform Frame_block_0Vertex { Frame _group_0_binding_0_vs; };

layout(location = 0) in vec2 _p2vs_location0;
layout(location = 1) in vec4 _p2vs_location1;
layout(location = 2) in vec4 _p2vs_location2;
smooth out vec2 _vs2fs_location0;
flat out float _vs2fs_location1;

float clipRoundBox(vec2 p, vec2 b, vec4 radii) {
    vec2 column = ((p.x > 0.0) ? radii.yz : radii.xw);
    float rad = ((p.y > 0.0) ? column.y : column.x);
    vec2 q = ((abs(p) - b) + vec2(rad));
    return ((min(max(q.x, q.y), 0.0) + length(max(q, vec2(0.0)))) - rad);
}

void main() {
    vec2 a_unit = _p2vs_location0;
    vec4 a_originAxisX = _p2vs_location1;
    vec4 a_axisYAlpha = _p2vs_location2;
    VOut out_ = VOut(vec4(0.0), vec2(0.0), 0.0);
    vec2 pos = ((a_originAxisX.xy + (a_originAxisX.zw * a_unit.x)) + (a_axisYAlpha.xy * a_unit.y));
    mat3x3 _e15 = _group_0_binding_0_vs.proj;
    vec3 clip = (_e15 * vec3(pos, 1.0));
    out_.pos = vec4(clip.xy, 0.0, 1.0);
    out_.uv = a_unit;
    out_.alpha = a_axisYAlpha.z;
    VOut _e27 = out_;
    gl_Position = _e27.pos;
    _vs2fs_location0 = _e27.uv;
    _vs2fs_location1 = _e27.alpha;
    return;
}

