#version 300 es

precision highp float;
precision highp int;

struct PbrFrame {
    mat4x4 viewProj;
    vec4 eyePos;
    vec4 ambient;
    vec4 fogColor;
    vec4 fogParams;
    vec4 debug;
    vec4 aoParams;
    vec4 aoParams2_;
};
struct PbrObject {
    mat4x4 model;
    mat4x4 normalMatrix;
    vec4 baseColorFactor;
    vec4 emissiveFactor;
    vec4 matParams0_;
    vec4 matParams1_;
    vec4 hasTex0_;
    vec4 hasTex1_;
};
struct Lights {
    ivec4 lightCountV;
    vec4 lightColor[8];
    vec4 lightPos[8];
    vec4 lightDir[8];
    vec4 lightCone[8];
    vec4 lightShadow[8];
};
struct ShadowFrame {
    mat4x4 shadowMat[4];
    vec4 shadowMeta;
};
struct VOut {
    vec4 pos;
    vec3 worldPos;
    vec3 normal;
    vec2 uv;
    vec4 tangent;
};
const int MAX_LIGHTS = 8;
const int MAX_PCF = 16;
const float PI = 3.1415927;
const vec2 PCF_DISK[16] = vec2[16](vec2(0.0, 0.0), vec2(-1.0, -1.0), vec2(1.0, -1.0), vec2(-1.0, 1.0), vec2(1.0, 1.0), vec2(-1.0, 0.0), vec2(1.0, 0.0), vec2(0.0, -1.0), vec2(0.0, 1.0), vec2(-2.0, -0.6), vec2(2.0, 0.6), vec2(-0.6, 2.0), vec2(0.6, -2.0), vec2(-2.0, 1.4), vec2(2.0, -1.4), vec2(1.4, 2.0));

layout(std140) uniform PbrFrame_block_0Vertex { PbrFrame _group_0_binding_1_vs; };

layout(std140) uniform PbrObject_block_1Vertex { PbrObject _group_1_binding_5_vs; };

layout(location = 0) in vec3 _p2vs_location0;
layout(location = 1) in vec3 _p2vs_location1;
layout(location = 2) in vec2 _p2vs_location2;
layout(location = 3) in vec4 _p2vs_location3;
smooth out vec3 _vs2fs_location0;
smooth out vec3 _vs2fs_location1;
smooth out vec2 _vs2fs_location2;
smooth out vec4 _vs2fs_location3;

mat3x3 mat3of(mat4x4 m) {
    return mat3x3(m[0].xyz, m[1].xyz, m[2].xyz);
}

vec3 linearToSrgb(vec3 c) {
    vec3 lo = (c * 12.92);
    vec3 hi = ((1.055 * pow(max(c, vec3(0.0)), vec3(0.41666666))) - vec3(0.055));
    return mix(lo, hi, step(vec3(0.0031308), c));
}

vec3 applyFog(vec3 color_1, vec3 worldPos) {
    float f = 0.0;
    float _e5 = _group_0_binding_1_vs.fogColor.w;
    if ((_e5 < 0.5)) {
        return color_1;
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
    return mix(color_1, _e52.xyz, _e54);
}

float distributionGGX(float NdotH, float rough) {
    float a = (rough * rough);
    float a2_ = (a * a);
    float d = (((NdotH * NdotH) * (a2_ - 1.0)) + 1.0);
    return (a2_ / max(((PI * d) * d), 1e-7));
}

float geometrySchlickGGX(float NdotX, float k) {
    return (NdotX / ((NdotX * (1.0 - k)) + k));
}

float geometrySmith(float NdotV, float NdotL, float rough_1) {
    float r = (rough_1 + 1.0);
    float k_1 = ((r * r) / 8.0);
    float _e8 = geometrySchlickGGX(NdotV, k_1);
    float _e9 = geometrySchlickGGX(NdotL, k_1);
    return (_e8 * _e9);
}

vec3 fresnelSchlick(float cosT, vec3 F0_) {
    return (F0_ + ((vec3(1.0) - F0_) * pow(clamp((1.0 - cosT), 0.0, 1.0), 5.0)));
}

mat3x3 derivativeTBN(vec3 N_1, vec3 dp1_, vec3 dp2_, vec2 duv1_, vec2 duv2_) {
    vec3 T = vec3(0.0);
    T = ((dp1_ * duv2_.y) - (dp2_ * duv1_.y));
    vec3 _e11 = T;
    vec3 _e12 = T;
    T = normalize((_e11 - (N_1 * dot(N_1, _e12))));
    vec3 _e17 = T;
    vec3 B = normalize(cross(N_1, _e17));
    vec3 _e20 = T;
    return mat3x3(_e20, B, N_1);
}

void main() {
    vec3 a_position = _p2vs_location0;
    vec3 a_normal = _p2vs_location1;
    vec2 a_uv = _p2vs_location2;
    vec4 a_tangent = _p2vs_location3;
    VOut out_ = VOut(vec4(0.0), vec3(0.0), vec3(0.0), vec2(0.0), vec4(0.0));
    mat4x4 _e7 = _group_1_binding_5_vs.model;
    vec4 worldPos_2 = (_e7 * vec4(a_position, 1.0));
    out_.worldPos = worldPos_2.xyz;
    mat4x4 _e16 = _group_0_binding_1_vs.viewProj;
    out_.pos = (_e16 * worldPos_2);
    mat4x4 _e20 = _group_1_binding_5_vs.normalMatrix;
    mat3x3 _e21 = mat3of(_e20);
    out_.normal = (_e21 * a_normal);
    out_.tangent = vec4((_e21 * a_tangent.xyz), a_tangent.w);
    out_.uv = a_uv;
    VOut _e30 = out_;
    gl_Position = _e30.pos;
    _vs2fs_location0 = _e30.worldPos;
    _vs2fs_location1 = _e30.normal;
    _vs2fs_location2 = _e30.uv;
    _vs2fs_location3 = _e30.tangent;
    return;
}

