#version 300 es

precision highp float;
precision highp int;

struct CubeCam {
    mat4x4 shadowViewProj;
    vec4 lightPos;
    vec4 far;
};
struct ShadowObject {
    mat4x4 model;
};
struct VOut {
    vec4 pos;
    vec3 worldPos;
};
layout(std140) uniform CubeCam_block_0Vertex { CubeCam _group_0_binding_1_vs; };

layout(std140) uniform ShadowObject_block_1Vertex { ShadowObject _group_1_binding_5_vs; };

layout(location = 0) in vec3 _p2vs_location0;
smooth out vec3 _vs2fs_location0;

void main() {
    vec3 a_position = _p2vs_location0;
    VOut out_ = VOut(vec4(0.0), vec3(0.0));
    mat4x4 _e4 = _group_1_binding_5_vs.model;
    vec4 worldPos = (_e4 * vec4(a_position, 1.0));
    out_.worldPos = worldPos.xyz;
    mat4x4 _e13 = _group_0_binding_1_vs.shadowViewProj;
    out_.pos = (_e13 * worldPos);
    VOut _e15 = out_;
    gl_Position = _e15.pos;
    _vs2fs_location0 = _e15.worldPos;
    return;
}

