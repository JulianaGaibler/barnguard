#version 300 es

precision highp float;
precision highp int;

struct Params {
    mat3x3 xform;
};
struct VOut {
    vec4 pos;
};
layout(location = 0) out vec4 _fs2p_location0;

void main() {
    VOut _in = VOut(gl_FragCoord);
    _fs2p_location0 = vec4(1.0, 1.0, 1.0, 1.0);
    return;
}

