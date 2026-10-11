#version 300 es

precision highp float;
precision highp int;

struct Params {
    vec4 p0_;
    vec4 tint;
};
struct VOut {
    vec4 pos;
    vec2 uv;
};
layout(location = 0) in vec2 _p2vs_location0;
layout(location = 1) in vec2 _p2vs_location1;
smooth out vec2 _vs2fs_location0;

float hash13_(vec3 p) {
    vec3 p3_ = vec3(0.0);
    p3_ = fract((p * 0.1031));
    vec3 _e5 = p3_;
    vec3 _e6 = p3_;
    vec3 _e7 = p3_;
    p3_ = (_e5 + vec3(dot(_e6, (_e7.zyx + vec3(31.32)))));
    float _e16 = p3_.x;
    float _e18 = p3_.y;
    float _e21 = p3_.z;
    return fract(((_e16 + _e18) * _e21));
}

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

