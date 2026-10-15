#version 300 es

precision highp float;
precision highp int;

struct VOut {
    vec4 pos;
    vec2 uv;
};
uniform highp sampler2D _group_0_binding_0_fs;

smooth in vec2 _vs2fs_location0;
layout(location = 0) out vec4 _fs2p_location0;

void main() {
    VOut in_ = VOut(gl_FragCoord, _vs2fs_location0);
    vec4 _e4 = texture(_group_0_binding_0_fs, vec2(in_.uv));
    _fs2p_location0 = _e4;
    return;
}

