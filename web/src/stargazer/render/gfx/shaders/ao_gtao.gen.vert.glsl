#version 300 es

precision highp float;
precision highp int;

struct Params {
    mat4x4 invProj;
    vec4 resTexel;
    vec4 radiusIntBias;
    vec4 stepsNearFar;
    vec4 proj;
};
struct VOut {
    vec4 pos;
    vec2 uv;
};
layout(location = 0) in vec2 _p2vs_location0;
smooth out vec2 _vs2fs_location0;

vec3 octDecode(vec2 e) {
    vec3 n = vec3(0.0);
    vec2 f = ((e * 2.0) - vec2(1.0));
    n = vec3(f.x, f.y, ((1.0 - abs(f.x)) - abs(f.y)));
    float _e18 = n.z;
    float t_1 = max(-(_e18), 0.0);
    float _e23 = n.x;
    float _e26 = n.x;
    n.x = (_e23 + ((_e26 >= 0.0) ? -(t_1) : t_1));
    float _e32 = n.y;
    float _e35 = n.y;
    n.y = (_e32 + ((_e35 >= 0.0) ? -(t_1) : t_1));
    vec3 _e40 = n;
    return normalize(_e40);
}

float unpack16_(vec2 ba) {
    return ((((ba.x * 255.0) * 256.0) + (ba.y * 255.0)) / 65535.0);
}

float hash(vec2 p) {
    return fract((52.982918 * fract(dot(p, vec2(0.06711056, 0.00583715)))));
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

