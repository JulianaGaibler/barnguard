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
    vec2 uv;
    float alpha;
};
layout(std140) uniform Frame_block_0Vertex { Frame _group_0_binding_0_vs; };

layout(location = 0) in vec2 _p2vs_location0;
layout(location = 1) in vec2 _p2vs_location1;
layout(location = 2) in vec2 _p2vs_location2;
smooth out vec2 _vs2fs_location0;
flat out float _vs2fs_location1;

float clipRoundBox(vec2 p, vec2 b, float rad) {
    vec2 q = ((abs(p) - b) + vec2(rad));
    return ((min(max(q.x, q.y), 0.0) + length(max(q, vec2(0.0)))) - rad);
}

void main() {
    vec2 a_unit = _p2vs_location0;
    vec2 a_center = _p2vs_location1;
    vec2 a_radAlpha = _p2vs_location2;
    VOut out_ = VOut(vec4(0.0), vec2(0.0), 0.0);
    float radius = a_radAlpha.x;
    vec2 p_1 = (a_center + (((a_unit - vec2(0.5)) * 2.0) * radius));
    mat3x3 _e14 = _group_0_binding_0_vs.proj;
    vec3 clip = (_e14 * vec3(p_1, 1.0));
    out_.pos = vec4(clip.xy, 0.0, 1.0);
    out_.uv = a_unit;
    out_.alpha = a_radAlpha.y;
    VOut _e26 = out_;
    gl_Position = _e26.pos;
    _vs2fs_location0 = _e26.uv;
    _vs2fs_location1 = _e26.alpha;
    return;
}

