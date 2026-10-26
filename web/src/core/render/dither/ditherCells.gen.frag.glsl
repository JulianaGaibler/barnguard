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

layout(std140) uniform DitherParams_block_0Fragment { DitherParams _group_0_binding_6_fs; };

uniform highp sampler2D _group_0_binding_0_fs;

smooth in vec2 _vs2fs_location0;
layout(location = 0) out vec4 _fs2p_location0;

bool rowsRunTopToBottom() {
    float _e3 = _group_0_binding_6_fs.frame.w;
    return (_e3 > 0.5);
}

int cellRow(int row, int rowCount) {
    bool _e5 = rowsRunTopToBottom();
    return (_e5 ? row : ((rowCount - 1) - row));
}

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
    uvec2 wrapped = uvec2(ivec2((cell.x & int((side - 1u))), (cell.y & int((side - 1u)))));
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
            uint xBit = ((wrapped.x >> _e23) & 1u);
            uint _e28 = bit;
            uint yBit = ((wrapped.y >> _e28) & 1u);
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

float toneMap(float value) {
    float tone = 0.0;
    float _e6 = _group_0_binding_6_fs.tone.x;
    tone = pow(max(value, 0.0), _e6);
    float _e9 = tone;
    float _e15 = _group_0_binding_6_fs.tone.y;
    float _e22 = _group_0_binding_6_fs.tone.z;
    tone = ((((_e9 - 0.5) * _e15) + 0.5) + _e22);
    float _e24 = tone;
    tone = clamp(_e24, 0.0, 1.0);
    float _e31 = _group_0_binding_6_fs.tone.w;
    if ((_e31 > 0.5)) {
        float _e34 = tone;
        tone = (1.0 - _e34);
    }
    float _e37 = tone;
    return _e37;
}

vec3 toneRgb(vec3 color) {
    float _e2 = toneMap(color.x);
    float _e4 = toneMap(color.y);
    float _e6 = toneMap(color.z);
    return vec3(_e2, _e4, _e6);
}

float quantize(float value_1, float threshold, uint levels) {
    float steps = float((max(levels, 2u) - 1u));
    return (clamp(floor(((value_1 * steps) + threshold)), 0.0, steps) / steps);
}

int paletteSize() {
    float _e3 = _group_0_binding_6_fs.flags.z;
    return min(max(int(_e3), 1), 16);
}

vec4 rampColor(float level) {
    int _e1 = paletteSize();
    int last = (_e1 - 1);
    vec4 _e14 = _group_0_binding_6_fs.palette[min(max(int(roundEven((level * float(last)))), 0), 15)];
    return _e14;
}

vec4 nearestPaletteColor(vec3 color_1) {
    vec4 best = vec4(0.0);
    float bestDistance = 1000000000.0;
    int index = 0;
    vec4 _e4 = _group_0_binding_6_fs.palette[0];
    best = _e4;
    bool loop_init_1 = true;
    while(true) {
        if (!loop_init_1) {
            int _e24 = index;
            index = (_e24 + 1);
        }
        loop_init_1 = false;
        int _e10 = index;
        int _e11 = paletteSize();
        if ((_e10 < _e11)) {
        } else {
            break;
        }
        {
            int _e15 = index;
            vec4 candidate = _group_0_binding_6_fs.palette[_e15];
            vec3 offset = (color_1 - candidate.xyz);
            float squaredDistance = dot(offset, offset);
            float _e21 = bestDistance;
            if ((squaredDistance < _e21)) {
                bestDistance = squaredDistance;
                best = candidate;
            }
        }
    }
    vec4 _e26 = best;
    return _e26;
}

vec4 premultiply(vec4 color_2) {
    return vec4((color_2.xyz * color_2.w), color_2.w);
}

void main() {
    VertexOut in_ = VertexOut(gl_FragCoord, _vs2fs_location0);
    vec4 sum = vec4(0.0);
    int tapRow = 0;
    int tapColumn = 0;
    vec4 _e3 = _group_0_binding_6_fs.cells;
    ivec2 cellCount = ivec2(_e3.xy);
    int column = int(floor(in_.position.x));
    int _e15 = cellRow(int(floor(in_.position.y)), cellCount.y);
    vec4 _e18 = _group_0_binding_6_fs.grid;
    vec2 cell_2 = (_e18.zw + vec2(float(column), float(_e15)));
    vec4 _e26 = _group_0_binding_6_fs.grid;
    float _e31 = _group_0_binding_6_fs.frame.z;
    vec2 cellCorner = (_e26.xy + (cell_2 * _e31));
    float _e37 = _group_0_binding_6_fs.cells.z;
    int taps = int(_e37);
    float _e42 = _group_0_binding_6_fs.frame.z;
    float tapSpacing = (_e42 / float(taps));
    bool loop_init_2 = true;
    while(true) {
        if (!loop_init_2) {
            int _e89 = tapRow;
            tapRow = (_e89 + 1);
        }
        loop_init_2 = false;
        int _e50 = tapRow;
        if ((_e50 < taps)) {
        } else {
            break;
        }
        {
            tapColumn = 0;
            bool loop_init_3 = true;
            while(true) {
                if (!loop_init_3) {
                    int _e86 = tapColumn;
                    tapColumn = (_e86 + 1);
                }
                loop_init_3 = false;
                int _e54 = tapColumn;
                if ((_e54 < taps)) {
                } else {
                    break;
                }
                {
                    int _e56 = tapColumn;
                    int _e58 = tapRow;
                    vec2 point_2 = (cellCorner + ((vec2(float(_e56), float(_e58)) + vec2(0.5)) * tapSpacing));
                    vec4 _e68 = _group_0_binding_6_fs.frame;
                    vec2 fromTop = (point_2 / _e68.xy);
                    bool _e76 = rowsRunTopToBottom();
                    vec2 uv = vec2(fromTop.x, (_e76 ? fromTop.y : (1.0 - fromTop.y)));
                    vec4 _e79 = sum;
                    vec4 _e83 = textureLod(_group_0_binding_0_fs, vec2(uv), 0.0);
                    sum = (_e79 + _e83);
                }
            }
        }
    }
    vec4 _e91 = sum;
    _fs2p_location0 = (_e91 / vec4(float((taps * taps))));
    return;
}

