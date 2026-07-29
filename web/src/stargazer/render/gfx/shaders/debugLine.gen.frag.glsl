#version 300 es

precision highp float;
precision highp int;

struct DebugCam {
    mat4x4 viewProj;
};
struct VOut {
    vec4 pos;
    vec4 color;
};
smooth in vec4 _vs2fs_location0;
layout(location = 0) out vec4 _fs2p_location0;

void main() {
    VOut in_ = VOut(gl_FragCoord, _vs2fs_location0);
    _fs2p_location0 = vec4((in_.color.xyz * in_.color.w), in_.color.w);
    return;
}

