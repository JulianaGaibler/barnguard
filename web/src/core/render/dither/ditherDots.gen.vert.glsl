#version 300 es

precision highp float;
precision highp int;

struct DitherParams {
    vec4 frame;
    vec4 grid;
    vec4 cells;
    vec4 modes;
    vec4 flags;
    vec4 tone;
    vec4 dot_;
    vec4 misc;
    vec4 paper;
    vec4 ink;
    vec4 palette[16];
};
struct VertexOut {
    vec4 position;
    vec2 uv;
};
const uint PATTERN_BAYER2_ = 0u;
const uint PATTERN_BAYER4_ = 1u;
const uint PATTERN_BAYER8_ = 2u;
const uint PATTERN_BLUE_NOISE = 3u;
const uint PATTERN_WHITE_NOISE = 4u;
const uint PATTERN_INTERLEAVED_GRADIENT = 5u;
const uint PATTERN_DIFFUSION = 6u;
const uint PATTERN_NONE = 7u;
const uint DOT_SQUARE = 0u;
const uint DOT_SQUARE_INSET = 1u;
const uint DOT_CIRCLE = 2u;
const uint DOT_CIRCLE_AM = 3u;
const uint DOT_SQUARE_AM = 4u;
const uint PALETTE_MONO = 0u;
const uint PALETTE_RAMP = 1u;
const uint PALETTE_NEAREST = 2u;
const uint PALETTE_SOURCE = 3u;
const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);
const float PI = 3.1415927;

layout(location = 0) in vec2 _p2vs_location0;
layout(location = 1) in vec2 _p2vs_location1;
smooth out vec2 _vs2fs_location0;

float hash21_(vec2 point) {
    vec3 mixed = vec3(0.0);
    mixed = fract((vec3(point.xyx) * 0.1031));
    vec3 _e7 = mixed;
    vec3 _e8 = mixed;
    vec3 _e9 = mixed;
    mixed = (_e7 + vec3(dot(_e8, (_e9.yzx + vec3(33.33)))));
    float _e18 = mixed.x;
    float _e20 = mixed.y;
    float _e23 = mixed.z;
    return fract(((_e18 + _e20) * _e23));
}

float bayerThreshold(ivec2 cell, uint bits) {
    uint rank = 0u;
    uint bit = 0u;
    uint side = (1u << bits);
    uvec2 wrapped_1 = uvec2(ivec2((cell.x & int((side - 1u))), (cell.y & int((side - 1u)))));
    bool loop_init = true;
    while(true) {
        if (!loop_init) {
            uint _e41 = bit;
            bit = (_e41 + 1u);
        }
        loop_init = false;
        uint _e20 = bit;
        if ((_e20 < bits)) {
        } else {
            break;
        }
        {
            uint _e23 = bit;
            uint xBit = ((wrapped_1.x >> _e23) & 1u);
            uint _e28 = bit;
            uint yBit = ((wrapped_1.y >> _e28) & 1u);
            uint _e32 = rank;
            rank = (((_e32 * 4u) + ((xBit ^ yBit) << 1u)) + yBit);
        }
    }
    uint _e43 = rank;
    return ((float(_e43) + 0.5) / float((side * side)));
}

float interleavedGradientThreshold(ivec2 cell_1) {
    vec2 point_1 = vec2(cell_1);
    return fract((52.982918 * fract(((0.06711056 * point_1.x) + (0.00583715 * point_1.y)))));
}

float quantize(float value_1, float threshold_1, uint levels_1) {
    float steps = float((max(levels_1, 2u) - 1u));
    return (clamp(floor(((value_1 * steps) + threshold_1)), 0.0, steps) / steps);
}

vec4 premultiply(vec4 color_2) {
    return vec4((color_2.xyz * color_2.w), color_2.w);
}

void main() {
    vec2 a_pos = _p2vs_location0;
    vec2 a_uv = _p2vs_location1;
    VertexOut out_ = VertexOut(vec4(0.0), vec2(0.0));
    out_.uv = a_uv;
    out_.position = vec4(a_pos, 0.0, 1.0);
    VertexOut _e8 = out_;
    gl_Position = _e8.position;
    _vs2fs_location0 = _e8.uv;
    return;
}

