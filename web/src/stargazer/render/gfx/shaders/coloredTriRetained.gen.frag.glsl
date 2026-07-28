#version 300 es

precision highp float;
precision highp int;

struct Frame {
    mat3x3 proj;
};
struct ModelColor {
    mat3x3 model;
    vec4 color;
};
struct VOut {
    vec4 pos;
};
layout(std140) uniform ModelColor_block_0Fragment { ModelColor _group_1_binding_3_fs; };

layout(location = 0) out vec4 _fs2p_location0;

void main() {
    vec4 _e2 = _group_1_binding_3_fs.color;
    _fs2p_location0 = _e2;
    return;
}

