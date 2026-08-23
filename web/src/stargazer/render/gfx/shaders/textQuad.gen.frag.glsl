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
    vec4 tint;
};
layout(std140) uniform Frame_block_0Fragment { Frame _group_0_binding_0_fs; };

layout(std140) uniform Clip_block_1Fragment { Clip _group_0_binding_8_fs; };

uniform highp sampler2D _group_1_binding_0_fs;

smooth in vec2 _vs2fs_location0;
smooth in vec4 _vs2fs_location1;
layout(location = 0) out vec4 _fs2p_location0;

float clipRoundBox(vec2 p, vec2 b, float rad) {
    vec2 q = ((abs(p) - b) + vec2(rad));
    return ((min(max(q.x, q.y), 0.0) + length(max(q, vec2(0.0)))) - rad);
}

float clipCoverage(vec2 fragPos) {
    float d = 0.0;
    float _e3 = _group_0_binding_8_fs.kind;
    if ((_e3 < 0.5)) {
        return 1.0;
    }
    float _e10 = _group_0_binding_0_fs.targetH;
    float _e15 = _group_0_binding_0_fs.fragYFlip;
    float fy = ((_e15 > 0.5) ? (_e10 - fragPos.y) : fragPos.y);
    float _e23 = _group_0_binding_8_fs.cx;
    float _e26 = _group_0_binding_8_fs.cy;
    vec2 p_1 = (vec2(fragPos.x, fy) - vec2(_e23, _e26));
    float _e32 = _group_0_binding_8_fs.kind;
    if ((_e32 < 1.5)) {
        float _e38 = _group_0_binding_8_fs.r;
        d = (length(p_1) - _e38);
    } else {
        float _e42 = _group_0_binding_8_fs.halfW;
        float _e45 = _group_0_binding_8_fs.halfH;
        float _e49 = _group_0_binding_8_fs.rrRadius;
        float _e50 = clipRoundBox(p_1, vec2(_e42, _e45), _e49);
        d = _e50;
    }
    float _e51 = d;
    float _e52 = d;
    float _e53 = fwidth(_e52);
    return clamp((0.5 - (_e51 / max(_e53, 0.0001))), 0.0, 1.0);
}

void main() {
    VOut in_ = VOut(gl_FragCoord, _vs2fs_location0, _vs2fs_location1);
    vec4 _e4 = texture(_group_1_binding_0_fs, vec2(in_.uv));
    float _e9 = clipCoverage(in_.pos.xy);
    _fs2p_location0 = ((_e4 * in_.tint) * _e9);
    return;
}

