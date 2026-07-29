#version 300 es

precision highp float;
precision highp int;

struct BlurParams {
    vec4 dirRes;
    vec4 control;
};
struct VOut {
    vec4 pos;
    vec2 uv;
};
layout(location = 0) in vec2 _p2vs_location0;
smooth out vec2 _vs2fs_location0;

float unpack16_(vec2 ba) {
    return ((((ba.x * 255.0) * 256.0) + (ba.y * 255.0)) / 65535.0);
}

void main() {
    vec2 a_pos = _p2vs_location0;
    VOut out_ = VOut(vec4(0.0), vec2(0.0));
    out_.uv = ((a_pos * 0.5) + vec2(0.5));
    out_.pos = vec4(a_pos, 0.0, 1.0);
    VOut _e12 = out_;
    gl_Position = _e12.pos;
    _vs2fs_location0 = _e12.uv;
    return;
}

