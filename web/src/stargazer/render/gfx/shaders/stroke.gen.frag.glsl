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
    vec2 alongPerp;
    float segLen;
    float halfWidth;
    float dashStart;
    float dashPeriod;
    float dashOnLen;
    vec4 color;
};
layout(std140) uniform Frame_block_0Fragment { Frame _group_0_binding_0_fs; };

layout(std140) uniform Clip_block_1Fragment { Clip _group_0_binding_8_fs; };

smooth in vec2 _vs2fs_location0;
flat in float _vs2fs_location1;
flat in float _vs2fs_location2;
flat in float _vs2fs_location3;
flat in float _vs2fs_location4;
flat in float _vs2fs_location5;
flat in vec4 _vs2fs_location6;
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
    VOut in_ = VOut(gl_FragCoord, _vs2fs_location0, _vs2fs_location1, _vs2fs_location2, _vs2fs_location3, _vs2fs_location4, _vs2fs_location5, _vs2fs_location6);
    float dist = 0.0;
    float alpha = 0.0;
    float along = in_.alongPerp.x;
    float perp = in_.alongPerp.y;
    if ((along < 0.0)) {
        dist = length(vec2(along, perp));
    } else {
        if ((along > in_.segLen)) {
            dist = length(vec2((along - in_.segLen), perp));
        } else {
            dist = abs(perp);
        }
    }
    float _e23 = dist;
    alpha = (1.0 - smoothstep((in_.halfWidth - 0.5), (in_.halfWidth + 0.5), _e23));
    if ((in_.dashPeriod > 0.0)) {
        float dashAlong = clamp(along, 0.0, in_.segLen);
        float s = (in_.dashStart + dashAlong);
        float phase = (s - (in_.dashPeriod * floor((s / in_.dashPeriod))));
        float off = smoothstep((in_.dashOnLen - 0.5), (in_.dashOnLen + 0.5), phase);
        float _e49 = alpha;
        alpha = (_e49 * (1.0 - off));
    }
    float _e53 = alpha;
    if ((_e53 <= 0.0)) {
        discard;
    }
    float _e57 = alpha;
    float _e60 = clipCoverage(in_.pos.xy);
    _fs2p_location0 = (in_.color * (_e57 * _e60));
    return;
}

