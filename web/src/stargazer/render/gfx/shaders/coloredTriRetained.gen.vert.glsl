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
layout(std140) uniform Frame_block_0Vertex { Frame _group_0_binding_0_vs; };

layout(std140) uniform ModelColor_block_1Vertex { ModelColor _group_1_binding_3_vs; };

layout(location = 0) in vec2 _p2vs_location0;

void main() {
    vec2 a_pos = _p2vs_location0;
    VOut out_ = VOut(vec4(0.0));
    mat3x3 _e4 = _group_1_binding_3_vs.model;
    vec3 world = (_e4 * vec3(a_pos, 1.0));
    mat3x3 _e10 = _group_0_binding_0_vs.proj;
    vec3 clip = (_e10 * vec3(world.xy, 1.0));
    out_.pos = vec4(clip.xy, 0.0, 1.0);
    VOut _e20 = out_;
    gl_Position = _e20.pos;
    return;
}

