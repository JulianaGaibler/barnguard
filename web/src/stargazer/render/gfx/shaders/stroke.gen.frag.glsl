#version 300 es

precision highp float;
precision highp int;

struct Frame {
    mat3x3 proj;
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
smooth in vec2 _vs2fs_location0;
flat in float _vs2fs_location1;
flat in float _vs2fs_location2;
flat in float _vs2fs_location3;
flat in float _vs2fs_location4;
flat in float _vs2fs_location5;
flat in vec4 _vs2fs_location6;
layout(location = 0) out vec4 _fs2p_location0;

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
    _fs2p_location0 = (in_.color * _e57);
    return;
}

