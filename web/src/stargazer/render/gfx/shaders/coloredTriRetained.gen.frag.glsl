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
struct ModelColor {
    mat3x3 model;
    vec4 color;
    vec4 paint;
    uvec4 flags;
};
struct VOut {
    vec4 pos;
};
layout(std140) uniform Frame_block_0Fragment { Frame _group_0_binding_0_fs; };

layout(std140) uniform Clip_block_1Fragment { Clip _group_0_binding_8_fs; };

layout(std140) uniform ModelColor_block_2Fragment { ModelColor _group_1_binding_3_fs; };

uniform highp sampler2D _group_1_binding_4_fs;

uniform highp sampler2D _group_1_binding_5_fs;

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

void main() {
    VOut in_ = VOut(gl_FragCoord);
    vec4 c = vec4(0.0);
    bool local = false;
    uint paintMode = _group_1_binding_3_fs.flags.x;
    if ((paintMode == 1u)) {
        vec2 _e10 = devicePos(in_.pos.xy);
        vec4 _e13 = _group_1_binding_3_fs.paint;
        float _e19 = _group_1_binding_3_fs.paint.z;
        float t = clamp((dot(_e10, _e13.xy) - _e19), 0.0, 1.0);
        float u = ((t * 0.99609375) + 0.001953125);
        float _e31 = _group_1_binding_3_fs.paint.w;
        float v = ((_e31 + 0.5) / 64.0);
        vec4 _e39 = texture(_group_1_binding_4_fs, vec2(vec2(u, v)));
        float _e43 = _group_1_binding_3_fs.color.w;
        c = (_e39 * _e43);
    } else {
        vec4 _e47 = _group_1_binding_3_fs.color;
        c = _e47;
    }
    if ((paintMode == 2u)) {
        vec2 _e52 = devicePos(in_.pos.xy);
        vec4 _e55 = _group_1_binding_3_fs.paint;
        vec4 _e60 = _group_1_binding_3_fs.paint;
        vec2 uv = ((_e52 - _e55.xy) * _e60.zw);
        if (all(greaterThanEqual(uv, vec2(0.0)))) {
            local = all(lessThanEqual(uv, vec2(1.0)));
        } else {
            local = false;
        }
        bool uvInside = local;
        vec4 _e77 = texture(_group_1_binding_5_fs, vec2(uv));
        float maskR = (uvInside ? _e77.x : 0.0);
        vec4 _e81 = c;
        c = (_e81 * (1.0 - maskR));
    }
    vec4 _e85 = c;
    float _e88 = clipCoverage(in_.pos.xy);
    _fs2p_location0 = (_e85 * _e88);
    return;
}

