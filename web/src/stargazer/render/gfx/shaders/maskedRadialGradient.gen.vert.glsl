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
    vec2 worldPos;
    vec4 grad;
};
layout(std140) uniform Frame_block_0Vertex { Frame _group_0_binding_0_vs; };

layout(location = 0) in vec2 _p2vs_location0;
layout(location = 1) in vec4 _p2vs_location1;
layout(location = 2) in vec4 _p2vs_location2;
layout(location = 3) in vec4 _p2vs_location3;
smooth out vec2 _vs2fs_location0;
smooth out vec2 _vs2fs_location1;
flat out vec4 _vs2fs_location2;

float clipRoundBox(vec2 p, vec2 b, float rad) {
    vec2 q = ((abs(p) - b) + vec2(rad));
    return ((min(max(q.x, q.y), 0.0) + length(max(q, vec2(0.0)))) - rad);
}

void main() {
    vec2 a_unit = _p2vs_location0;
    vec4 a_dst = _p2vs_location1;
    vec4 a_srcRect = _p2vs_location2;
    vec4 a_grad = _p2vs_location3;
    VOut out_ = VOut(vec4(0.0), vec2(0.0), vec2(0.0), vec4(0.0));
    vec2 pos = (a_dst.xy + (a_dst.zw * a_unit));
    mat3x3 _e11 = _group_0_binding_0_vs.proj;
    vec3 clip = (_e11 * vec3(pos, 1.0));
    out_.pos = vec4(clip.xy, 0.0, 1.0);
    out_.uv = mix(a_srcRect.xy, a_srcRect.zw, a_unit);
    out_.worldPos = pos;
    out_.grad = a_grad;
    VOut _e26 = out_;
    gl_Position = _e26.pos;
    _vs2fs_location0 = _e26.uv;
    _vs2fs_location1 = _e26.worldPos;
    _vs2fs_location2 = _e26.grad;
    return;
}

