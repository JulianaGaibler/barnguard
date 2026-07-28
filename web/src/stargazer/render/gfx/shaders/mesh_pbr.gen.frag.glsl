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

layout(std140) uniform PbrFrame_block_0Fragment { PbrFrame _group_0_binding_1_fs; };

layout(std140) uniform PbrObject_block_1Fragment { PbrObject _group_1_binding_5_fs; };

layout(std140) uniform Lights_block_2Fragment { Lights _group_0_binding_4_fs; };

layout(std140) uniform ShadowFrame_block_3Fragment { ShadowFrame _group_0_binding_7_fs; };

uniform highp sampler2DArrayShadow _group_0_binding_8_fs;

uniform highp samplerCubeShadow _group_0_binding_9_fs;

uniform highp sampler2D _group_1_binding_10_fs;

uniform highp sampler2D _group_1_binding_11_fs;

uniform highp sampler2D _group_1_binding_12_fs;

uniform highp sampler2D _group_1_binding_13_fs;

uniform highp sampler2D _group_1_binding_14_fs;

uniform highp sampler2D _group_1_binding_15_fs;

smooth in vec3 _vs2fs_location0;
smooth in vec3 _vs2fs_location1;
smooth in vec2 _vs2fs_location2;
smooth in vec4 _vs2fs_location3;
layout(location = 0) out vec4 _fs2p_location0;

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
    float _e5 = _group_0_binding_1_fs.fogColor.w;
    if ((_e5 < 0.5)) {
        return color_1;
    }
    vec4 _e10 = _group_0_binding_1_fs.eyePos;
    float dist = length((_e10.xyz - worldPos));
    float _e18 = _group_0_binding_1_fs.fogParams.x;
    if ((_e18 < 0.5)) {
        float _e24 = _group_0_binding_1_fs.fogParams.y;
        f = (1.0 - exp((-(_e24) * dist)));
    } else {
        float _e33 = _group_0_binding_1_fs.fogParams.z;
        float _e38 = _group_0_binding_1_fs.fogParams.w;
        float _e42 = _group_0_binding_1_fs.fogParams.z;
        f = clamp(((dist - _e33) / max((_e38 - _e42), 0.0001)), 0.0, 1.0);
    }
    vec4 _e52 = _group_0_binding_1_fs.fogColor;
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

float sampleShadowArray(int layer, vec3 uvz) {
    bool local_1 = false;
    bool local_2 = false;
    bool local_3 = false;
    bool local_4 = false;
    bool local_5 = false;
    float s = 0.0;
    int i_1 = 0;
    if (!((uvz.x < 0.0))) {
        local_1 = (uvz.x > 1.0);
    } else {
        local_1 = true;
    }
    bool _e12 = local_1;
    if (!(_e12)) {
        local_2 = (uvz.y < 0.0);
    } else {
        local_2 = true;
    }
    bool _e20 = local_2;
    if (!(_e20)) {
        local_3 = (uvz.y > 1.0);
    } else {
        local_3 = true;
    }
    bool _e28 = local_3;
    if (!(_e28)) {
        local_4 = (uvz.z < 0.0);
    } else {
        local_4 = true;
    }
    bool _e36 = local_4;
    if (!(_e36)) {
        local_5 = (uvz.z > 1.0);
    } else {
        local_5 = true;
    }
    bool _e44 = local_5;
    if (_e44) {
        return 1.0;
    }
    float _e49 = _group_0_binding_7_fs.shadowMeta.y;
    int samples = int((_e49 + 0.5));
    float t = _group_0_binding_7_fs.shadowMeta.x;
    bool loop_init = true;
    while(true) {
        if (!loop_init) {
            int _e78 = i_1;
            i_1 = (_e78 + 1);
        }
        loop_init = false;
        int _e61 = i_1;
        if ((_e61 < MAX_PCF)) {
        } else {
            break;
        }
        {
            int _e64 = i_1;
            if ((_e64 >= samples)) {
                break;
            }
            float _e66 = s;
            int _e71 = i_1;
            float _e76 = textureGrad(_group_0_binding_8_fs, vec4((uvz.xy + (PCF_DISK[_e71] * t)), layer, uvz.z), vec2(0.0), vec2(0.0));
            s = (_e66 + _e76);
        }
    }
    float _e81 = s;
    return (_e81 / float(samples));
}

float shadowVisibility(int i_2, vec3 L_1, vec3 worldPos_1, vec3 normal) {
    vec3 base = vec3(0.0);
    float shadow = 0.0;
    vec3 uvz_1 = vec3(0.0);
    float _e8 = _group_0_binding_4_fs.lightShadow[i_2].x;
    int kind = int((_e8 + 0.5));
    if ((kind == 0)) {
        return 1.0;
    }
    vec3 gN = normalize(normal);
    float _e26 = _group_0_binding_4_fs.lightShadow[i_2].w;
    base = (gN * ((1.0 - clamp(dot(L_1, gN), 0.0, 1.0)) * _e26));
    vec3 _e30 = base;
    vec3 _e31 = base;
    base = (_e30 - (L_1 * dot(L_1, _e31)));
    vec3 _e35 = base;
    vec3 wp = (worldPos_1 + _e35);
    if ((kind == 1)) {
        float _e44 = _group_0_binding_4_fs.lightShadow[i_2].y;
        int layer_1 = int((_e44 + 0.5));
        mat4x4 _e51 = _group_0_binding_7_fs.shadowMat[layer_1];
        vec4 sc = (_e51 * vec4(wp, 1.0));
        vec3 ndc = (sc.xyz / vec3(sc.w));
        uvz_1.x = ((ndc.x * 0.5) + 0.5);
        float _e80 = _group_0_binding_7_fs.shadowMeta.w;
        uvz_1.y = ((_e80 > 0.5) ? (0.5 - (ndc.y * 0.5)) : ((ndc.y * 0.5) + 0.5));
        float _e94 = _group_0_binding_7_fs.shadowMeta.z;
        uvz_1.z = ((_e94 > 0.5) ? ndc.z : ((ndc.z * 0.5) + 0.5));
        float _e101 = _group_0_binding_7_fs.shadowMeta.z;
        float biasScale = ((_e101 > 0.5) ? 0.5 : 1.0);
        float _e109 = uvz_1.z;
        float _e114 = _group_0_binding_4_fs.lightShadow[i_2].z;
        uvz_1.z = (_e109 - (_e114 * biasScale));
        vec3 _e117 = uvz_1;
        float _e118 = sampleShadowArray(layer_1, _e117);
        shadow = _e118;
    } else {
        vec4 _e122 = _group_0_binding_4_fs.lightPos[i_2];
        vec3 toFrag = (wp - _e122.xyz);
        float _e130 = _group_0_binding_4_fs.lightShadow[i_2].z;
        float _e136 = _group_0_binding_4_fs.lightShadow[i_2].y;
        float refDepth = ((length(toFrag) - _e130) / _e136);
        float _e141 = textureGrad(_group_0_binding_9_fs, vec4(normalize(toFrag), refDepth), vec3(0.0), vec3(0.0));
        shadow = _e141;
    }
    float _e142 = shadow;
    float _e147 = _group_0_binding_4_fs.lightColor[i_2].w;
    return mix(1.0, _e142, _e147);
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
    VOut in_ = VOut(gl_FragCoord, _vs2fs_location0, _vs2fs_location1, _vs2fs_location2, _vs2fs_location3);
    bool frontFacing = gl_FrontFacing;
    vec4 baseColor = vec4(0.0);
    bool local = false;
    vec3 N = vec3(0.0);
    vec3 tn = vec3(0.0);
    mat3x3 TBN = mat3x3(0.0);
    float metallic = 0.0;
    float roughness = 0.0;
    vec3 Lo = vec3(0.0);
    int i = 0;
    vec3 L = vec3(0.0);
    float atten = 0.0;
    vec3 tcol = vec3(0.0);
    float ao = 1.0;
    vec3 color = vec3(0.0);
    vec3 emissive = vec3(0.0);
    vec4 baseTexel = texture(_group_1_binding_10_fs, vec2(in_.uv));
    vec4 mrTexel = texture(_group_1_binding_11_fs, vec2(in_.uv));
    vec4 normalTexel = texture(_group_1_binding_12_fs, vec2(in_.uv));
    vec4 occTexel = texture(_group_1_binding_13_fs, vec2(in_.uv));
    vec4 emissiveTexel = texture(_group_1_binding_14_fs, vec2(in_.uv));
    vec4 diffTransTexel = texture(_group_1_binding_15_fs, vec2(in_.uv));
    vec3 dp1_1 = dFdx(in_.worldPos);
    vec3 dp2_1 = dFdy(in_.worldPos);
    vec2 duv1_1 = dFdx(in_.uv);
    vec2 duv2_1 = dFdy(in_.uv);
    float debugMode = _group_0_binding_1_fs.debug.x;
    float normalScale = _group_1_binding_5_fs.matParams0_.w;
    float hasTangent = _group_1_binding_5_fs.matParams1_.z;
    float _e49 = _group_1_binding_5_fs.matParams1_.w;
    int alphaMode = int((_e49 + 0.5));
    float alphaCutoff = _group_1_binding_5_fs.matParams1_.x;
    vec4 _e59 = _group_1_binding_5_fs.baseColorFactor;
    baseColor = _e59;
    float _e64 = _group_1_binding_5_fs.hasTex0_.x;
    if ((_e64 > 0.5)) {
        vec4 _e67 = baseColor;
        baseColor = (_e67 * baseTexel);
    }
    float alpha = baseColor.w;
    if ((alphaMode == 1)) {
        local = (alpha < alphaCutoff);
    } else {
        local = false;
    }
    bool _e77 = local;
    if (_e77) {
        discard;
    }
    N = normalize(in_.normal);
    if (!(frontFacing)) {
        vec3 _e82 = N;
        N = -(_e82);
    }
    float _e87 = _group_1_binding_5_fs.hasTex0_.z;
    if ((_e87 > 0.5)) {
        tn = ((normalTexel.xyz * 2.0) - vec3(1.0));
        vec3 _e97 = tn;
        float _e101 = tn.z;
        tn = vec3((_e97.xy * normalScale), _e101);
        if ((hasTangent > 0.5)) {
            vec3 T_1 = normalize(in_.tangent.xyz);
            vec3 _e109 = N;
            vec3 B_1 = normalize((cross(_e109, T_1) * in_.tangent.w));
            vec3 _e115 = N;
            TBN = mat3x3(T_1, B_1, _e115);
        } else {
            vec3 _e117 = N;
            mat3x3 _e118 = derivativeTBN(_e117, dp1_1, dp2_1, duv1_1, duv2_1);
            TBN = _e118;
        }
        mat3x3 _e119 = TBN;
        vec3 _e120 = tn;
        N = normalize((_e119 * _e120));
    }
    if ((debugMode > 1.5)) {
        vec3 _e125 = N;
        _fs2p_location0 = vec4((((_e125 * 0.5) + vec3(0.5)) * alpha), alpha);
        return;
    }
    if ((debugMode > 0.5)) {
        vec4 _e135 = baseColor;
        vec3 _e137 = linearToSrgb(_e135.xyz);
        _fs2p_location0 = vec4((_e137 * alpha), alpha);
        return;
    }
    float _e143 = _group_1_binding_5_fs.matParams0_.x;
    metallic = _e143;
    float _e148 = _group_1_binding_5_fs.matParams0_.y;
    roughness = _e148;
    float _e153 = _group_1_binding_5_fs.hasTex0_.y;
    if ((_e153 > 0.5)) {
        float _e156 = roughness;
        roughness = (_e156 * mrTexel.y);
        float _e159 = metallic;
        metallic = (_e159 * mrTexel.z);
    }
    float _e162 = roughness;
    roughness = clamp(_e162, 0.04, 1.0);
    vec4 _e168 = _group_0_binding_1_fs.eyePos;
    vec3 V = normalize((_e168.xyz - in_.worldPos));
    vec3 _e173 = N;
    float NdotV_1 = max(dot(_e173, V), 0.0001);
    vec4 _e179 = baseColor;
    float _e181 = metallic;
    vec3 F0_1 = mix(vec3(0.04), _e179.xyz, _e181);
    vec4 _e183 = baseColor;
    float _e185 = metallic;
    vec3 diffuseColor = (_e183.xyz * (1.0 - _e185));
    float diffuseTransmission = _group_1_binding_5_fs.matParams1_.y;
    int lightCount = _group_0_binding_4_fs.lightCountV.x;
    bool loop_init_1 = true;
    while(true) {
        if (!loop_init_1) {
            int _e390 = i;
            i = (_e390 + 1);
        }
        loop_init_1 = false;
        int _e202 = i;
        if ((_e202 < MAX_LIGHTS)) {
        } else {
            break;
        }
        {
            int _e205 = i;
            if ((_e205 >= lightCount)) {
                break;
            }
            int _e209 = i;
            float _e212 = _group_0_binding_4_fs.lightPos[_e209].w;
            int ltype = int((_e212 + 0.5));
            L = vec3(0.0);
            atten = 1.0;
            if ((ltype == 0)) {
                int _e224 = i;
                vec4 _e226 = _group_0_binding_4_fs.lightDir[_e224];
                L = normalize(-(_e226.xyz));
            } else {
                int _e232 = i;
                vec4 _e234 = _group_0_binding_4_fs.lightPos[_e232];
                vec3 toL = (_e234.xyz - in_.worldPos);
                float dist_1 = max(length(toL), 0.0001);
                L = (toL / vec3(dist_1));
                atten = (1.0 / max((dist_1 * dist_1), 0.0001));
                int _e250 = i;
                float range = _group_0_binding_4_fs.lightDir[_e250].w;
                if ((range > 0.0)) {
                    float f_1 = clamp((1.0 - pow((dist_1 / range), 4.0)), 0.0, 1.0);
                    float _e264 = atten;
                    atten = ((_e264 * f_1) * f_1);
                }
                if ((ltype == 2)) {
                    int _e271 = i;
                    vec4 _e273 = _group_0_binding_4_fs.lightDir[_e271];
                    vec3 _e276 = L;
                    float cd = dot(normalize(_e273.xyz), -(_e276));
                    float _e279 = atten;
                    int _e282 = i;
                    float _e285 = _group_0_binding_4_fs.lightCone[_e282].y;
                    int _e289 = i;
                    float _e292 = _group_0_binding_4_fs.lightCone[_e289].x;
                    int _e295 = i;
                    float _e298 = _group_0_binding_4_fs.lightCone[_e295].y;
                    atten = (_e279 * clamp(((cd - _e285) / max((_e292 - _e298), 0.0001)), 0.0, 1.0));
                }
            }
            int _e309 = i;
            vec4 _e311 = _group_0_binding_4_fs.lightColor[_e309];
            float _e313 = atten;
            int _e315 = i;
            vec3 _e316 = L;
            float _e319 = shadowVisibility(_e315, _e316, in_.worldPos, in_.normal);
            vec3 radiance = ((_e311.xyz * _e313) * _e319);
            vec3 _e321 = N;
            vec3 _e322 = L;
            float NdotL_1 = max(dot(_e321, _e322), 0.0);
            vec3 _e326 = L;
            vec3 H = normalize((V + _e326));
            vec3 _e329 = N;
            float NdotH_1 = max(dot(_e329, H), 0.0);
            float _e333 = roughness;
            float _e334 = distributionGGX(NdotH_1, _e333);
            float _e335 = roughness;
            float _e336 = geometrySmith(NdotV_1, NdotL_1, _e335);
            vec3 _e340 = fresnelSchlick(max(dot(H, V), 0.0), F0_1);
            vec3 spec = (((_e334 * _e336) * _e340) / vec3(max(((4.0 * NdotV_1) * NdotL_1), 0.0001)));
            float _e353 = metallic;
            vec3 kd = ((vec3(1.0) - _e340) * (1.0 - _e353));
            vec3 _e357 = Lo;
            Lo = (_e357 + (((((kd * diffuseColor) / vec3(3.1415927)) + spec) * radiance) * NdotL_1));
            if ((diffuseTransmission > 0.0)) {
                tcol = diffuseColor;
                float _e372 = _group_1_binding_5_fs.hasTex1_.y;
                if ((_e372 > 0.5)) {
                    vec3 _e375 = tcol;
                    tcol = (_e375 * diffTransTexel.xyz);
                }
                vec3 _e378 = Lo;
                vec3 _e379 = tcol;
                vec3 _e380 = N;
                vec3 _e382 = L;
                Lo = (_e378 + ((_e379 * (diffuseTransmission * max(dot(-(_e380), _e382), 0.0))) * radiance));
            }
        }
    }
    float _e398 = _group_1_binding_5_fs.hasTex0_.w;
    if ((_e398 > 0.5)) {
        float _e405 = _group_1_binding_5_fs.matParams0_.z;
        ao = mix(1.0, occTexel.x, _e405);
    }
    vec3 _e408 = Lo;
    vec4 _e411 = _group_0_binding_1_fs.ambient;
    float _e415 = ao;
    color = ((_e408 + (_e411.xyz * diffuseColor)) * _e415);
    vec4 _e420 = _group_1_binding_5_fs.emissiveFactor;
    emissive = _e420.xyz;
    float _e426 = _group_1_binding_5_fs.hasTex1_.x;
    if ((_e426 > 0.5)) {
        vec3 _e429 = emissive;
        emissive = (_e429 * emissiveTexel.xyz);
    }
    vec3 _e432 = color;
    vec3 _e433 = emissive;
    color = (_e432 + _e433);
    vec3 _e435 = color;
    vec3 _e436 = linearToSrgb(_e435);
    vec3 _e438 = applyFog(_e436, in_.worldPos);
    color = _e438;
    vec3 _e439 = color;
    _fs2p_location0 = vec4((_e439 * alpha), alpha);
    return;
}

