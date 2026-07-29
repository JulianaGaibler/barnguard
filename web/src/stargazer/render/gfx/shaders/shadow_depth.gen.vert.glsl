#version 300 es

precision highp float;
precision highp int;

struct ShadowCam {
    mat4x4 shadowViewProj;
};
struct ShadowObject {
    mat4x4 model;
};
layout(std140) uniform ShadowCam_block_0Vertex { ShadowCam _group_0_binding_1_vs; };

layout(std140) uniform ShadowObject_block_1Vertex { ShadowObject _group_1_binding_5_vs; };

layout(location = 0) in vec3 _p2vs_location0;

void main() {
    vec3 a_position = _p2vs_location0;
    mat4x4 _e3 = _group_0_binding_1_vs.shadowViewProj;
    mat4x4 _e6 = _group_1_binding_5_vs.model;
    gl_Position = ((_e3 * _e6) * vec4(a_position, 1.0));
    return;
}

