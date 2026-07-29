#version 300 es

precision highp float;
precision highp int;

struct Frame {
    mat4x4 viewProj;
    mat4x4 view;
    vec4 nearFar;
};
struct Obj {
    mat4x4 model;
};
struct VOut {
    vec4 pos;
    vec3 viewNormal;
    float viewZ;
};
layout(std140) uniform Frame_block_0Vertex { Frame _group_0_binding_1_vs; };

layout(std140) uniform Obj_block_1Vertex { Obj _group_1_binding_5_vs; };

layout(location = 0) in vec3 _p2vs_location0;
layout(location = 1) in vec3 _p2vs_location1;
smooth out vec3 _vs2fs_location0;
smooth out float _vs2fs_location1;

vec2 signNotZero(vec2 v) {
    return vec2(((v.x >= 0.0) ? 1.0 : -1.0), ((v.y >= 0.0) ? 1.0 : -1.0));
}

vec2 octEncode(vec3 n) {
    float d = ((abs(n.x) + abs(n.y)) + abs(n.z));
    vec2 p = (n.xy / vec2(max(d, 1e-8)));
    vec2 _e19 = signNotZero(p);
    vec2 enc = ((n.z < 0.0) ? ((vec2(1.0) - abs(p.yx)) * _e19) : p);
    return ((enc * 0.5) + vec2(0.5));
}

vec2 pack16_(float v_1) {
    float s = (clamp(v_1, 0.0, 1.0) * 65535.0);
    float hi = floor((s / 256.0));
    return vec2((hi / 255.0), ((s - (hi * 256.0)) / 255.0));
}

void main() {
    vec3 a_position = _p2vs_location0;
    vec3 a_normal = _p2vs_location1;
    VOut out_ = VOut(vec4(0.0), vec3(0.0), 0.0);
    mat4x4 _e5 = _group_1_binding_5_vs.model;
    vec4 world = (_e5 * vec4(a_position, 1.0));
    mat4x4 _e12 = _group_0_binding_1_vs.viewProj;
    out_.pos = (_e12 * world);
    mat4x4 _e17 = _group_0_binding_1_vs.view;
    mat4x4 _e20 = _group_1_binding_5_vs.model;
    out_.viewNormal = ((_e17 * _e20) * vec4(a_normal, 0.0)).xyz;
    mat4x4 _e29 = _group_0_binding_1_vs.view;
    out_.viewZ = (_e29 * world).z;
    VOut _e32 = out_;
    gl_Position = _e32.pos;
    _vs2fs_location0 = _e32.viewNormal;
    _vs2fs_location1 = _e32.viewZ;
    return;
}

