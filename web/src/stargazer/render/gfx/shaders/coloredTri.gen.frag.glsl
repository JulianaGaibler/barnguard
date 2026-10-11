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

layout(std140) uniform Frame_block_0Fragment { Frame _group_0_binding_0_fs; };

layout(std140) uniform Clip_block_1Fragment { Clip _group_0_binding_8_fs; };

layout(std140) uniform DrawParams_block_2Fragment { DrawParams _group_1_binding_2_fs; };

uniform highp sampler2D _group_1_binding_1_fs;

uniform highp sampler2D _group_1_binding_3_fs;

uniform highp sampler2D _group_1_binding_4_fs;

smooth in vec4 _vs2fs_location0;
smooth in vec2 _vs2fs_location1;
layout(location = 0) out vec4 _fs2p_location0;

vec2 devicePos(vec2 fragPos) {
    float _e4 = _group_0_binding_0_fs.targetH;
    float _e9 = _group_0_binding_0_fs.fragYFlip;
    float fy = ((_e9 > 0.5) ? (_e4 - fragPos.y) : fragPos.y);
    return vec2(fragPos.x, fy);
}

float clipRoundBox(vec2 p, vec2 b, float rad) {
    vec2 q = ((abs(p) - b) + vec2(rad));
    return ((min(max(q.x, q.y), 0.0) + length(max(q, vec2(0.0)))) - rad);
}

float clipCoverage(vec2 fragPos_1) {
    float d = 0.0;
    float _e3 = _group_0_binding_8_fs.kind;
    if ((_e3 < 0.5)) {
        return 1.0;
    }
    vec2 _e7 = devicePos(fragPos_1);
    float _e10 = _group_0_binding_8_fs.cx;
    float _e13 = _group_0_binding_8_fs.cy;
    vec2 p_1 = (_e7 - vec2(_e10, _e13));
    float _e19 = _group_0_binding_8_fs.kind;
    if ((_e19 < 1.5)) {
        float _e25 = _group_0_binding_8_fs.r;
        d = (length(p_1) - _e25);
    } else {
        float _e29 = _group_0_binding_8_fs.halfW;
        float _e32 = _group_0_binding_8_fs.halfH;
        float _e36 = _group_0_binding_8_fs.rrRadius;
        float _e37 = clipRoundBox(p_1, vec2(_e29, _e32), _e36);
        d = _e37;
    }
    float _e38 = d;
    float _e39 = d;
    float _e40 = fwidth(_e39);
    return clamp((0.5 - (_e38 / max(_e40, 0.0001))), 0.0, 1.0);
}

float bayerValue(vec2 fragPos_2) {
    ivec2 xy = (ivec2(fragPos_2) & ivec2(7, 7));
    return (BAYER8_[((xy.y * 8) + xy.x)] / 64.0);
}

void main() {
    VOut in_ = VOut(gl_FragCoord, _vs2fs_location0, _vs2fs_location1);
    vec4 c = vec4(0.0);
    bool local = false;
    uint paintMode = _group_1_binding_2_fs.flags.z;
    if ((paintMode == 1u)) {
        vec2 _e10 = devicePos(in_.pos.xy);
        vec4 _e13 = _group_1_binding_2_fs.paint;
        float _e19 = _group_1_binding_2_fs.paint.z;
        float t = clamp((dot(_e10, _e13.xy) - _e19), 0.0, 1.0);
        float u = ((t * 0.99609375) + 0.001953125);
        float _e31 = _group_1_binding_2_fs.paint.w;
        float v = ((_e31 + 0.5) / 64.0);
        vec4 _e39 = texture(_group_1_binding_3_fs, vec2(vec2(u, v)));
        float _e43 = _group_1_binding_2_fs.misc.y;
        c = (_e39 * _e43);
    } else {
        c = in_.color;
    }
    if ((paintMode == 2u)) {
        vec2 _e50 = devicePos(in_.pos.xy);
        vec4 _e53 = _group_1_binding_2_fs.paint;
        vec4 _e58 = _group_1_binding_2_fs.paint;
        vec2 uv = ((_e50 - _e53.xy) * _e58.zw);
        if (all(greaterThanEqual(uv, vec2(0.0)))) {
            local = all(lessThanEqual(uv, vec2(1.0)));
        } else {
            local = false;
        }
        bool uvInside = local;
        vec4 _e75 = texture(_group_1_binding_4_fs, vec2(uv));
        float maskR = (uvInside ? _e75.x : 0.0);
        vec4 _e79 = c;
        c = (_e79 * (1.0 - maskR));
    }
    uint _e86 = _group_1_binding_2_fs.flags.x;
    if ((_e86 > 0u)) {
        vec4 _e89 = c;
        vec4 _e93 = texture(_group_1_binding_1_fs, vec2(in_.uv));
        c = (_e89 * _e93.w);
    }
    vec4 _e96 = c;
    float _e99 = clipCoverage(in_.pos.xy);
    c = (_e96 * _e99);
    uint _e104 = _group_1_binding_2_fs.flags.w;
    if ((_e104 > 0u)) {
        float _e109 = bayerValue(in_.pos.xy);
        float _e115 = c.w;
        float noise = (((_e109 - 0.5) / 256.0) * _e115);
        vec4 _e117 = c;
        float _e122 = c.w;
        float _e126 = c.w;
        c = vec4(min((_e117.xyz + vec3(noise)), vec3(_e122)), _e126);
    }
    uint mode = _group_1_binding_2_fs.flags.y;
    if ((mode == 1u)) {
        c = vec4(0.05, 0.0, 0.0, 0.05);
    } else {
        if ((mode == 2u)) {
            vec4 _e143 = _group_1_binding_2_fs.debugColor;
            c = _e143;
        }
    }
    vec4 _e144 = c;
    _fs2p_location0 = _e144;
    return;
}

