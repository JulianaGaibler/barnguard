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

uniform highp sampler2D _group_0_binding_1_fs;

uniform highp sampler2D _group_0_binding_2_fs;

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

float quantize(float value_1, float threshold_1, uint levels_1) {
    float steps = float((max(levels_1, 2u) - 1u));
    return (clamp(floor(((value_1 * steps) + threshold_1)), 0.0, steps) / steps);
}

int paletteSize() {
    float _e3 = _group_0_binding_6_fs.flags.z;
    return min(max(int(_e3), 1), 16);
}

vec4 rampColor(float level_1) {
    int _e1 = paletteSize();
    int last = (_e1 - 1);
    vec4 _e14 = _group_0_binding_6_fs.palette[min(max(int(roundEven((level_1 * float(last)))), 0), 15)];
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

float blueNoiseThreshold(ivec2 cell_2) {
    ivec2 wrapped = ivec2(0);
    ivec2 side_1 = ivec2(uvec2(textureSize(_group_0_binding_1_fs, 0).xy));
    wrapped = cell_2;
    float _e9 = _group_0_binding_6_fs.flags.x;
    if ((_e9 > 0.5)) {
        float _e19 = _group_0_binding_6_fs.cells.w;
        vec2 shift = floor((vec2(side_1) * fract((vec2(0.7548777, 0.5698403) * floor(_e19)))));
        ivec2 _e25 = wrapped;
        wrapped = (_e25 + ivec2(shift));
    }
    ivec2 _e28 = wrapped;
    wrapped = (((_e28 % side_1) + side_1) % side_1);
    ivec2 _e33 = wrapped;
    vec4 _e35 = texelFetch(_group_0_binding_1_fs, _e33, 0);
    return (((_e35.x * 255.0) + 0.5) / 256.0);
}

float cellThreshold(ivec2 cell_3) {
    float _e4 = _group_0_binding_6_fs.modes.x;
    switch(uint(_e4)) {
        case 0u: {
            float _e7 = bayerThreshold(cell_3, 1u);
            return _e7;
        }
        case 1u: {
            float _e9 = bayerThreshold(cell_3, 2u);
            return _e9;
        }
        case 2u: {
            float _e11 = bayerThreshold(cell_3, 3u);
            return _e11;
        }
        case 3u: {
            float _e12 = blueNoiseThreshold(cell_3);
            return _e12;
        }
        case 4u: {
            float _e16 = _group_0_binding_6_fs.cells.w;
            float _e23 = _group_0_binding_6_fs.flags.x;
            float reseed = ((_e23 > 0.5) ? (floor(_e16) * 13.37) : 0.0);
            float _e31 = hash21_((vec2(cell_3) + vec2(reseed)));
            return _e31;
        }
        case 5u: {
            float _e32 = interleavedGradientThreshold(cell_3);
            return _e32;
        }
        default: {
            return 0.5;
        }
    }
}

vec4 cellColor(float level_2, float threshold_2, vec3 source) {
    float _e6 = _group_0_binding_6_fs.modes.z;
    switch(uint(_e6)) {
        case 1u: {
            vec4 _e8 = rampColor(level_2);
            return _e8;
        }
        case 2u: {
            vec3 _e9 = toneRgb(source);
            float _e15 = _group_0_binding_6_fs.misc.x;
            vec3 nudged = clamp((_e9 + vec3(((threshold_2 - 0.5) * _e15))), vec3(0.0), vec3(1.0));
            vec4 _e24 = nearestPaletteColor(nudged);
            return _e24;
        }
        case 3u: {
            vec4 _e27 = _group_0_binding_6_fs.paper;
            float _e33 = _group_0_binding_6_fs.paper.w;
            return vec4(mix(_e27.xyz, source, level_2), mix(_e33, 1.0, level_2));
        }
        default: {
            vec4 _e39 = _group_0_binding_6_fs.paper;
            vec4 _e42 = _group_0_binding_6_fs.ink;
            return mix(_e39, _e42, level_2);
        }
    }
}

vec4 inkColor(vec3 source_1) {
    float _e4 = _group_0_binding_6_fs.modes.z;
    switch(uint(_e4)) {
        case 1u: {
            int _e8 = paletteSize();
            vec4 _e12 = _group_0_binding_6_fs.palette[(_e8 - 1)];
            return _e12;
        }
        case 2u: {
            vec3 _e13 = toneRgb(source_1);
            vec4 _e14 = nearestPaletteColor(_e13);
            return _e14;
        }
        case 3u: {
            return vec4(source_1, 1.0);
        }
        default: {
            vec4 _e19 = _group_0_binding_6_fs.ink;
            return _e19;
        }
    }
}

float dotCoverage(vec2 inCell, float level_3) {
    float cellPx = _group_0_binding_6_fs.frame.z;
    float _e9 = _group_0_binding_6_fs.dot_.z;
    float edge = (max(_e9, 0.01) / cellPx);
    vec2 fromCenter = (inCell - vec2(0.5));
    float _e19 = _group_0_binding_6_fs.modes.y;
    switch(uint(_e19)) {
        case 1u: {
            float _e24 = _group_0_binding_6_fs.dot_.x;
            float halfSide = (0.5 * _e24);
            return (1.0 - smoothstep((halfSide - edge), (halfSide + edge), max(abs(fromCenter.x), abs(fromCenter.y))));
        }
        case 2u: {
            float _e40 = _group_0_binding_6_fs.dot_.x;
            float radius = (0.5 * _e40);
            return (1.0 - smoothstep((radius - edge), (radius + edge), length(fromCenter)));
        }
        case 3u: {
            if ((level_3 <= 0.0005)) {
                return 0.0;
            }
            float _e58 = _group_0_binding_6_fs.dot_.x;
            float _e63 = _group_0_binding_6_fs.dot_.y;
            float radius_1 = max((sqrt((level_3 / PI)) * _e58), _e63);
            return (1.0 - smoothstep((radius_1 - edge), (radius_1 + edge), length(fromCenter)));
        }
        case 4u: {
            if ((level_3 <= 0.0005)) {
                return 0.0;
            }
            float _e80 = _group_0_binding_6_fs.dot_.x;
            float _e85 = _group_0_binding_6_fs.dot_.y;
            float halfSide_1 = max(((0.5 * sqrt(level_3)) * _e80), _e85);
            return (1.0 - smoothstep((halfSide_1 - edge), (halfSide_1 + edge), max(abs(fromCenter.x), abs(fromCenter.y))));
        }
        default: {
            return 1.0;
        }
    }
}

void main() {
    VertexOut in_ = VertexOut(gl_FragCoord, _vs2fs_location0);
    bool local = false;
    uint levels = 0u;
    float threshold = 0.5;
    float level = 0.0;
    vec4 result = vec4(0.0);
    bool local_1 = false;
    float cellPx_1 = _group_0_binding_6_fs.frame.z;
    float _e10 = _group_0_binding_6_fs.frame.y;
    bool _e16 = rowsRunTopToBottom();
    vec2 fromTop = vec2(in_.position.x, (_e16 ? in_.position.y : (_e10 - in_.position.y)));
    vec4 _e21 = _group_0_binding_6_fs.grid;
    vec2 gridPosition = ((fromTop - _e21.xy) / vec2(cellPx_1));
    ivec2 cell_4 = ivec2(floor(gridPosition));
    vec2 inCell_1 = fract(gridPosition);
    vec4 _e31 = _group_0_binding_6_fs.cells;
    ivec2 cellCount = ivec2(_e31.xy);
    vec4 _e36 = _group_0_binding_6_fs.grid;
    ivec2 local_2 = (cell_4 - ivec2(_e36.zw));
    int _e53 = cellRow(min(max(local_2.y, 0), (cellCount.y - 1)), cellCount.y);
    ivec2 texel = ivec2(min(max(local_2.x, 0), (cellCount.x - 1)), _e53);
    vec4 average = texelFetch(_group_0_binding_0_fs, texel, 0);
    float _e61 = _group_0_binding_6_fs.dot_.w;
    if ((_e61 > 0.0)) {
        float _e70 = _group_0_binding_6_fs.dot_.w;
        local = (average.w < _e70);
    } else {
        local = false;
    }
    bool _e73 = local;
    if (_e73) {
        _fs2p_location0 = vec4(0.0);
        return;
    }
    vec3 source_2 = (average.xyz / vec3(max(average.w, 0.0001)));
    float _e84 = toneMap(dot(source_2, LUMA));
    float _e88 = _group_0_binding_6_fs.modes.w;
    levels = uint(_e88);
    float _e94 = _group_0_binding_6_fs.modes.z;
    if ((uint(_e94) == PALETTE_RAMP)) {
        int _e98 = paletteSize();
        levels = uint(_e98);
    }
    level = _e84;
    float _e106 = _group_0_binding_6_fs.modes.x;
    if ((uint(_e106) == PATTERN_DIFFUSION)) {
        ivec2 maskCount = ivec2(uvec2(textureSize(_group_0_binding_2_fs, 0).xy));
        int _e127 = cellRow(min(max(local_2.y, 0), (maskCount.y - 1)), maskCount.y);
        ivec2 maskTexel = ivec2(min(max(local_2.x, 0), (maskCount.x - 1)), _e127);
        vec4 _e131 = texelFetch(_group_0_binding_2_fs, maskTexel, 0);
        level = _e131.x;
    } else {
        float _e133 = cellThreshold(cell_4);
        threshold = _e133;
        uint _e134 = levels;
        if ((_e134 >= 2u)) {
            float _e137 = threshold;
            uint _e138 = levels;
            float _e139 = quantize(_e84, _e137, _e138);
            level = _e139;
        }
    }
    float _e143 = _group_0_binding_6_fs.modes.y;
    uint shape = uint(_e143);
    if (!((shape == DOT_CIRCLE_AM))) {
        local_1 = (shape == DOT_SQUARE_AM);
    } else {
        local_1 = true;
    }
    bool _e154 = local_1;
    if (_e154) {
        vec4 _e157 = _group_0_binding_6_fs.paper;
        vec4 _e158 = premultiply(_e157);
        vec4 _e159 = inkColor(source_2);
        vec4 _e160 = premultiply(_e159);
        float _e161 = level;
        float _e162 = dotCoverage(inCell_1, _e161);
        result = mix(_e158, _e160, _e162);
    } else {
        float _e164 = level;
        float _e165 = threshold;
        vec4 _e166 = cellColor(_e164, _e165, source_2);
        vec4 _e167 = premultiply(_e166);
        if ((shape == DOT_SQUARE)) {
            result = _e167;
        } else {
            vec4 _e172 = _group_0_binding_6_fs.paper;
            vec4 _e173 = premultiply(_e172);
            float _e174 = level;
            float _e175 = dotCoverage(inCell_1, _e174);
            result = mix(_e173, _e167, _e175);
        }
    }
    vec4 _e177 = result;
    _fs2p_location0 = _e177;
    return;
}

