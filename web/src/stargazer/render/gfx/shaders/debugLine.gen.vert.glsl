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
layout(std140) uniform DebugCam_block_0Vertex { DebugCam _group_0_binding_1_vs; };

layout(location = 0) in vec3 _p2vs_location0;
layout(location = 1) in vec4 _p2vs_location1;
smooth out vec4 _vs2fs_location0;

void main() {
    vec3 a_position = _p2vs_location0;
    vec4 a_color = _p2vs_location1;
    VOut out_ = VOut(vec4(0.0), vec4(0.0));
    mat4x4 _e6 = _group_0_binding_1_vs.viewProj;
    out_.pos = (_e6 * vec4(a_position, 1.0));
    out_.color = a_color;
    VOut _e11 = out_;
    gl_Position = _e11.pos;
    _vs2fs_location0 = _e11.color;
    return;
}

