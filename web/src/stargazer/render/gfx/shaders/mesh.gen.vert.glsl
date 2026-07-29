#version 300 es

precision highp float;
precision highp int;

struct FlatFrame {
    mat4x4 viewProj;
    vec4 eyePos;
    vec4 ambient;
    vec4 fogColor;
    vec4 fogParams;
    vec4 lightDir;
    vec4 lightColor;
    vec4 debug;
    vec4 aoParams;
    vec4 aoParams2_;
};
struct FlatObject {
    mat4x4 model;
    vec4 color;
    vec4 flags;
};
struct VOut {
    vec4 pos;
    vec3 worldPos;
    vec3 normal;
    vec2 uv;
};
layout(std140) uniform FlatFrame_block_0Vertex { FlatFrame _group_0_binding_1_vs; };

layout(std140) uniform FlatObject_block_1Vertex { FlatObject _group_1_binding_5_vs; };

layout(location = 0) in vec3 _p2vs_location0;
layout(location = 1) in vec3 _p2vs_location1;
layout(location = 2) in vec2 _p2vs_location2;
smooth out vec3 _vs2fs_location0;
smooth out vec3 _vs2fs_location1;
smooth out vec2 _vs2fs_location2;

mat3x3 mat3of(mat4x4 m) {
    return mat3x3(m[0].xyz, m[1].xyz, m[2].xyz);
}

vec3 applyFog(vec3 color, vec3 worldPos) {
    float f = 0.0;
    float _e5 = _group_0_binding_1_vs.fogColor.w;
    if ((_e5 < 0.5)) {
        return color;
    }
    vec4 _e10 = _group_0_binding_1_vs.eyePos;
    float dist = length((_e10.xyz - worldPos));
    float _e18 = _group_0_binding_1_vs.fogParams.x;
    if ((_e18 < 0.5)) {
        float _e24 = _group_0_binding_1_vs.fogParams.y;
        f = (1.0 - exp((-(_e24) * dist)));
    } else {
        float _e33 = _group_0_binding_1_vs.fogParams.z;
        float _e38 = _group_0_binding_1_vs.fogParams.w;
        float _e42 = _group_0_binding_1_vs.fogParams.z;
        f = clamp(((dist - _e33) / max((_e38 - _e42), 0.0001)), 0.0, 1.0);
    }
    vec4 _e52 = _group_0_binding_1_vs.fogColor;
    float _e54 = f;
    return mix(color, _e52.xyz, _e54);
}

void main() {
    vec3 a_position = _p2vs_location0;
    vec3 a_normal = _p2vs_location1;
    vec2 a_uv = _p2vs_location2;
    VOut out_ = VOut(vec4(0.0), vec3(0.0), vec3(0.0), vec2(0.0));
    mat4x4 _e6 = _group_1_binding_5_vs.model;
    vec4 worldPos_1 = (_e6 * vec4(a_position, 1.0));
    out_.worldPos = worldPos_1.xyz;
    mat4x4 _e15 = _group_0_binding_1_vs.viewProj;
    out_.pos = (_e15 * worldPos_1);
    mat4x4 _e20 = _group_1_binding_5_vs.model;
    mat3x3 _e21 = mat3of(_e20);
    out_.normal = (_e21 * a_normal);
    out_.uv = a_uv;
    VOut _e24 = out_;
    gl_Position = _e24.pos;
    _vs2fs_location0 = _e24.worldPos;
    _vs2fs_location1 = _e24.normal;
    _vs2fs_location2 = _e24.uv;
    return;
}

