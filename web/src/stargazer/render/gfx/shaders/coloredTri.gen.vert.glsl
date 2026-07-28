#version 300 es

precision highp float;
precision highp int;

struct Frame {
    mat3x3 proj;
};
struct DrawParams {
    vec4 debugColor;
    float clipEnabled;
    float debugMode;
    vec2 pad;
};
struct VOut {
    vec4 pos;
    vec4 color;
    vec2 uv;
};
layout(std140) uniform Frame_block_0Vertex { Frame _group_0_binding_0_vs; };

layout(location = 0) in vec2 _p2vs_location0;
layout(location = 1) in vec4 _p2vs_location1;
layout(location = 2) in vec2 _p2vs_location2;
smooth out vec4 _vs2fs_location0;
smooth out vec2 _vs2fs_location1;

void main() {
    vec2 a_pos = _p2vs_location0;
    vec4 a_color = _p2vs_location1;
    vec2 a_uv = _p2vs_location2;
    VOut out_ = VOut(vec4(0.0), vec4(0.0), vec2(0.0));
    mat3x3 _e6 = _group_0_binding_0_vs.proj;
    vec3 clip = (_e6 * vec3(a_pos, 1.0));
    out_.pos = vec4(clip.xy, 0.0, 1.0);
    out_.color = a_color;
    out_.uv = a_uv;
    VOut _e17 = out_;
    gl_Position = _e17.pos;
    _vs2fs_location0 = _e17.color;
    _vs2fs_location1 = _e17.uv;
    return;
}

