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
layout(std140) uniform Frame_block_0Fragment { Frame _group_0_binding_1_fs; };

smooth in vec3 _vs2fs_location0;
smooth in float _vs2fs_location1;
layout(location = 0) out vec4 _fs2p_location0;

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
    VOut in_ = VOut(gl_FragCoord, _vs2fs_location0, _vs2fs_location1);
    vec2 _e3 = octEncode(normalize(in_.viewNormal));
    float near = _group_0_binding_1_fs.nearFar.x;
    float far = _group_0_binding_1_fs.nearFar.y;
    float lin = clamp(((-(in_.viewZ) - near) / max((far - near), 0.0001)), 0.0, 1.0);
    vec2 _e22 = pack16_(lin);
    _fs2p_location0 = vec4(_e3.x, _e3.y, _e22.x, _e22.y);
    return;
}

