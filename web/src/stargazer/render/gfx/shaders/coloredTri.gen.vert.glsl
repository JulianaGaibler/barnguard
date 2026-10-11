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
struct DrawParams {
    vec4 debugColor;
    vec4 paint;
    vec4 misc;
    uvec4 flags;
};
struct VOut {
    vec4 pos;
    vec4 color;
    vec2 uv;
};
const float BAYER8_[64] = float[64](0.0, 32.0, 8.0, 40.0, 2.0, 34.0, 10.0, 42.0, 48.0, 16.0, 56.0, 24.0, 50.0, 18.0, 58.0, 26.0, 12.0, 44.0, 4.0, 36.0, 14.0, 46.0, 6.0, 38.0, 60.0, 28.0, 52.0, 20.0, 62.0, 30.0, 54.0, 22.0, 3.0, 35.0, 11.0, 43.0, 1.0, 33.0, 9.0, 41.0, 51.0, 19.0, 59.0, 27.0, 49.0, 17.0, 57.0, 25.0, 15.0, 47.0, 7.0, 39.0, 13.0, 45.0, 5.0, 37.0, 63.0, 31.0, 55.0, 23.0, 61.0, 29.0, 53.0, 21.0);

layout(std140) uniform Frame_block_0Vertex { Frame _group_0_binding_0_vs; };

layout(location = 0) in vec2 _p2vs_location0;
layout(location = 1) in vec4 _p2vs_location1;
layout(location = 2) in vec2 _p2vs_location2;
smooth out vec4 _vs2fs_location0;
smooth out vec2 _vs2fs_location1;

vec2 devicePos(vec2 fragPos) {
    float _e4 = _group_0_binding_0_vs.targetH;
    float _e9 = _group_0_binding_0_vs.fragYFlip;
    float fy = ((_e9 > 0.5) ? (_e4 - fragPos.y) : fragPos.y);
    return vec2(fragPos.x, fy);
}

float clipRoundBox(vec2 p, vec2 b, float rad) {
    vec2 q = ((abs(p) - b) + vec2(rad));
    return ((min(max(q.x, q.y), 0.0) + length(max(q, vec2(0.0)))) - rad);
}

float bayerValue(vec2 fragPos_2) {
    ivec2 xy = (ivec2(fragPos_2) & ivec2(7, 7));
    return (BAYER8_[((xy.y * 8) + xy.x)] / 64.0);
}

void main() {
    vec2 a_pos = _p2vs_location0;
    vec4 a_color = _p2vs_location1;
    vec2 a_uv = _p2vs_location2;
    VOut out_ = VOut(vec4(0.0), vec4(0.0), vec2(0.0));
    mat3x3 _e6 = _group_0_binding_0_vs.proj;
    vec3 clip = (_e6 * vec3(a_pos, 1.0));
    out_.pos = vec4(clip.xy, 0.0, 1.0);
    out_.color = a_color;
    out_.uv = a_uv;
    VOut _e17 = out_;
    gl_Position = _e17.pos;
    _vs2fs_location0 = _e17.color;
    _vs2fs_location1 = _e17.uv;
    return;
}

