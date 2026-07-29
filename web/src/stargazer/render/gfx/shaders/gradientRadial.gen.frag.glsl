#version 300 es

precision highp float;
precision highp int;

struct Frame {
    mat3x3 proj;
};
struct VOut {
    vec4 pos;
    vec2 uv;
    float alpha;
};
uniform highp sampler2D _group_1_binding_0_fs;

smooth in vec2 _vs2fs_location0;
flat in float _vs2fs_location1;
layout(location = 0) out vec4 _fs2p_location0;

void main() {
    VOut in_ = VOut(gl_FragCoord, _vs2fs_location0, _vs2fs_location1);
    float t = (length((in_.uv - vec2(0.5))) * 2.0);
    if ((t > 1.0)) {
        discard;
    }
    vec4 c = texture(_group_1_binding_0_fs, vec2(vec2(t, 0.5)));
    _fs2p_location0 = (c * in_.alpha);
    return;
}

