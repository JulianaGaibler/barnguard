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

layout(std140) uniform PbrFrame_block_0Fragment { PbrFrame _group_0_binding_1_fs; };

uniform highp sampler2D _group_0_binding_2_fs;

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

float sampleSSAO(vec4 fragPos) {
    vec2 uv = vec2(0.0);
    float _e4 = _group_0_binding_1_fs.aoParams.x;
    if ((_e4 < 0.5)) {
        return 1.0;
    }
    vec4 _e11 = _group_0_binding_1_fs.aoParams;
    uv = (fragPos.xy / _e11.zw);
    float _e18 = _group_0_binding_1_fs.aoParams.y;
    if ((_e18 > 0.5)) {
        float _e23 = uv.y;
        uv.y = (1.0 - _e23);
    }
    vec2 _e28 = uv;
    vec4 _e30 = textureLod(_group_0_binding_2_fs, vec2(_e28), 0.0);
    return _e30.x;
}

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
    float matAo = 1.0;
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
    if ((debugMode > 2.5)) {
        float _e126 = sampleSSAO(in_.pos);
        _fs2p_location0 = vec4((_e126 * alpha), (_e126 * alpha), (_e126 * alpha), alpha);
        return;
    }
    if ((debugMode > 1.5)) {
        vec3 _e133 = N;
        _fs2p_location0 = vec4((((_e133 * 0.5) + vec3(0.5)) * alpha), alpha);
        return;
    }
    if ((debugMode > 0.5)) {
        vec4 _e143 = baseColor;
        vec3 _e145 = linearToSrgb(_e143.xyz);
        _fs2p_location0 = vec4((_e145 * alpha), alpha);
        return;
    }
    float _e151 = _group_1_binding_5_fs.matParams0_.x;
    metallic = _e151;
    float _e156 = _group_1_binding_5_fs.matParams0_.y;
    roughness = _e156;
    float _e161 = _group_1_binding_5_fs.hasTex0_.y;
    if ((_e161 > 0.5)) {
        float _e164 = roughness;
        roughness = (_e164 * mrTexel.y);
        float _e167 = metallic;
        metallic = (_e167 * mrTexel.z);
    }
    float _e170 = roughness;
    roughness = clamp(_e170, 0.04, 1.0);
    vec4 _e176 = _group_0_binding_1_fs.eyePos;
    vec3 V = normalize((_e176.xyz - in_.worldPos));
    vec3 _e181 = N;
    float NdotV_1 = max(dot(_e181, V), 0.0001);
    vec4 _e187 = baseColor;
    float _e189 = metallic;
    vec3 F0_1 = mix(vec3(0.04), _e187.xyz, _e189);
    vec4 _e191 = baseColor;
    float _e193 = metallic;
    vec3 diffuseColor = (_e191.xyz * (1.0 - _e193));
    float diffuseTransmission = _group_1_binding_5_fs.matParams1_.y;
    float _e202 = sampleSSAO(in_.pos);
    float _e206 = _group_0_binding_1_fs.aoParams2_.x;
    float aoDirect = mix(1.0, _e202, _e206);
    int lightCount = _group_0_binding_4_fs.lightCountV.x;
    bool loop_init_1 = true;
    while(true) {
        if (!loop_init_1) {
            int _e408 = i;
            i = (_e408 + 1);
        }
        loop_init_1 = false;
        int _e218 = i;
        if ((_e218 < MAX_LIGHTS)) {
        } else {
            break;
        }
        {
            int _e221 = i;
            if ((_e221 >= lightCount)) {
                break;
            }
            int _e225 = i;
            float _e228 = _group_0_binding_4_fs.lightPos[_e225].w;
            int ltype = int((_e228 + 0.5));
            L = vec3(0.0);
            atten = 1.0;
            if ((ltype == 0)) {
                int _e240 = i;
                vec4 _e242 = _group_0_binding_4_fs.lightDir[_e240];
                L = normalize(-(_e242.xyz));
            } else {
                int _e248 = i;
                vec4 _e250 = _group_0_binding_4_fs.lightPos[_e248];
                vec3 toL = (_e250.xyz - in_.worldPos);
                float dist_1 = max(length(toL), 0.0001);
                L = (toL / vec3(dist_1));
                atten = (1.0 / max((dist_1 * dist_1), 0.0001));
                int _e266 = i;
                float range = _group_0_binding_4_fs.lightDir[_e266].w;
                if ((range > 0.0)) {
                    float f_1 = clamp((1.0 - pow((dist_1 / range), 4.0)), 0.0, 1.0);
                    float _e280 = atten;
                    atten = ((_e280 * f_1) * f_1);
                }
                if ((ltype == 2)) {
                    int _e287 = i;
                    vec4 _e289 = _group_0_binding_4_fs.lightDir[_e287];
                    vec3 _e292 = L;
                    float cd = dot(normalize(_e289.xyz), -(_e292));
                    float _e295 = atten;
                    int _e298 = i;
                    float _e301 = _group_0_binding_4_fs.lightCone[_e298].y;
                    int _e305 = i;
                    float _e308 = _group_0_binding_4_fs.lightCone[_e305].x;
                    int _e311 = i;
                    float _e314 = _group_0_binding_4_fs.lightCone[_e311].y;
                    atten = (_e295 * clamp(((cd - _e301) / max((_e308 - _e314), 0.0001)), 0.0, 1.0));
                }
            }
            int _e325 = i;
            vec4 _e327 = _group_0_binding_4_fs.lightColor[_e325];
            float _e329 = atten;
            int _e331 = i;
            vec3 _e332 = L;
            float _e335 = shadowVisibility(_e331, _e332, in_.worldPos, in_.normal);
            vec3 radiance = ((_e327.xyz * _e329) * _e335);
            vec3 _e337 = N;
            vec3 _e338 = L;
            float NdotL_1 = max(dot(_e337, _e338), 0.0);
            vec3 _e342 = L;
            vec3 H = normalize((V + _e342));
            vec3 _e345 = N;
            float NdotH_1 = max(dot(_e345, H), 0.0);
            float _e349 = roughness;
            float _e350 = distributionGGX(NdotH_1, _e349);
            float _e351 = roughness;
            float _e352 = geometrySmith(NdotV_1, NdotL_1, _e351);
            vec3 _e356 = fresnelSchlick(max(dot(H, V), 0.0), F0_1);
            vec3 spec = (((_e350 * _e352) * _e356) / vec3(max(((4.0 * NdotV_1) * NdotL_1), 0.0001)));
            float _e369 = metallic;
            vec3 kd = ((vec3(1.0) - _e356) * (1.0 - _e369));
            vec3 _e373 = Lo;
            Lo = (_e373 + ((((((kd * diffuseColor) / vec3(3.1415927)) * aoDirect) + spec) * radiance) * NdotL_1));
            if ((diffuseTransmission > 0.0)) {
                tcol = diffuseColor;
                float _e389 = _group_1_binding_5_fs.hasTex1_.y;
                if ((_e389 > 0.5)) {
                    vec3 _e392 = tcol;
                    tcol = (_e392 * diffTransTexel.xyz);
                }
                vec3 _e395 = Lo;
                vec3 _e396 = tcol;
                vec3 _e397 = N;
                vec3 _e399 = L;
                Lo = (_e395 + (((_e396 * (diffuseTransmission * max(dot(-(_e397), _e399), 0.0))) * radiance) * aoDirect));
            }
        }
    }
    float _e416 = _group_1_binding_5_fs.hasTex0_.w;
    if ((_e416 > 0.5)) {
        float _e423 = _group_1_binding_5_fs.matParams0_.z;
        matAo = mix(1.0, occTexel.x, _e423);
    }
    float _e426 = matAo;
    float indirectAo = min(_e202, _e426);
    vec3 _e428 = Lo;
    vec4 _e431 = _group_0_binding_1_fs.ambient;
    color = (_e428 + ((_e431.xyz * diffuseColor) * indirectAo));
    vec4 _e439 = _group_1_binding_5_fs.emissiveFactor;
    emissive = _e439.xyz;
    float _e445 = _group_1_binding_5_fs.hasTex1_.x;
    if ((_e445 > 0.5)) {
        vec3 _e448 = emissive;
        emissive = (_e448 * emissiveTexel.xyz);
    }
    vec3 _e451 = color;
    vec3 _e452 = emissive;
    color = (_e451 + _e452);
    vec3 _e454 = color;
    vec3 _e455 = linearToSrgb(_e454);
    vec3 _e457 = applyFog(_e455, in_.worldPos);
    color = _e457;
    vec3 _e458 = color;
    _fs2p_location0 = vec4((_e458 * alpha), alpha);
    return;
}

