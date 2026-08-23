#version 300 es

precision highp float;
precision highp int;

struct Params {
    vec4 ca;
};
struct VOut {
    vec4 pos;
    vec2 uv;
};
layout(location = 0) in vec2 _p2vs_location0;
layout(location = 1) in vec2 _p2vs_location1;
smooth out vec2 _vs2fs_location0;

void main() {
    vec2 a_pos = _p2vs_location0;
    vec2 a_uv = _p2vs_location1;
    VOut out_ = VOut(vec4(0.0), vec2(0.0));
    out_.uv = a_uv;
    out_.pos = vec4(a_pos, 0.0, 1.0);
    VOut _e8 = out_;
    gl_Position = _e8.pos;
    _vs2fs_location0 = _e8.uv;
    return;
}

