#version 300 es

precision highp float;
precision highp int;

struct Frame {
    mat3x3 proj;
};
struct VOut {
    vec4 pos;
    vec2 uv;
    vec2 worldPos;
    vec4 grad;
};
uniform highp sampler2D _group_1_binding_0_fs;

uniform highp sampler2D _group_1_binding_1_fs;

smooth in vec2 _vs2fs_location0;
smooth in vec2 _vs2fs_location1;
flat in vec4 _vs2fs_location2;
layout(location = 0) out vec4 _fs2p_location0;

void main() {
    VOut in_ = VOut(gl_FragCoord, _vs2fs_location0, _vs2fs_location1, _vs2fs_location2);
    vec4 _e4 = texture(_group_1_binding_0_fs, vec2(in_.uv));
    float maskA = _e4.w;
    float radius = max(in_.grad.z, 0.0001);
    float t = clamp((distance(in_.worldPos, in_.grad.xy) / radius), 0.0, 1.0);
    vec4 stopColor = texture(_group_1_binding_1_fs, vec2(vec2(t, 0.5)));
    _fs2p_location0 = (stopColor * (maskA * in_.grad.w));
    return;
}

