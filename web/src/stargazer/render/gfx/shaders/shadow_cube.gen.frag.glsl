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
layout(std140) uniform CubeCam_block_0Fragment { CubeCam _group_0_binding_1_fs; };

smooth in vec3 _vs2fs_location0;

void main() {
    VOut in_ = VOut(gl_FragCoord, _vs2fs_location0);
    vec4 _e4 = _group_0_binding_1_fs.lightPos;
    float _e11 = _group_0_binding_1_fs.far.x;
    gl_FragDepth = clamp((length((in_.worldPos - _e4.xyz)) / _e11), 0.0, 1.0);
    return;
}

