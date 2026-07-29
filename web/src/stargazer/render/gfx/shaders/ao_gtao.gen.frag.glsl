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
layout(std140) uniform Params_block_0Fragment { Params _group_0_binding_6_fs; };

uniform highp sampler2D _group_0_binding_0_fs;

smooth in vec2 _vs2fs_location0;
layout(location = 0) out vec4 _fs2p_location0;

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

vec4 loadG(vec2 uv) {
    vec4 _e3 = _group_0_binding_6_fs.resTexel;
    vec2 res = _e3.xy;
    ivec2 c = min(max(ivec2((uv * res)), ivec2(0)), (ivec2(res) - ivec2(1)));
    vec4 _e16 = texelFetch(_group_0_binding_0_fs, c, 0);
    return _e16;
}

vec2 ndcXY(vec2 uv_1) {
    float x = ((uv_1.x * 2.0) - 1.0);
    float _e19 = _group_0_binding_6_fs.proj.w;
    float y = ((_e19 > 0.5) ? (1.0 - (uv_1.y * 2.0)) : ((uv_1.y * 2.0) - 1.0));
    return vec2(x, y);
}

vec3 viewPos(vec2 uv_2, float lin) {
    vec2 _e2 = ndcXY(uv_2);
    mat4x4 _e5 = _group_0_binding_6_fs.invProj;
    float _e9 = _group_0_binding_6_fs.stepsNearFar.w;
    vec4 a4_ = (_e5 * vec4(_e2, _e9, 1.0));
    mat4x4 _e15 = _group_0_binding_6_fs.invProj;
    float _e19 = _group_0_binding_6_fs.proj.x;
    vec4 b4_ = (_e15 * vec4(_e2, _e19, 1.0));
    vec3 a = (a4_.xyz / vec3(a4_.w));
    vec3 b = (b4_.xyz / vec3(b4_.w));
    float _e34 = _group_0_binding_6_fs.stepsNearFar.y;
    float _e38 = _group_0_binding_6_fs.stepsNearFar.z;
    float viewZ = -(mix(_e34, _e38, lin));
    float t_2 = ((viewZ - a.z) / (b.z - a.z));
    return (a + (t_2 * (b - a)));
}

float hash(vec2 p) {
    return fract((52.982918 * fract(dot(p, vec2(0.06711056, 0.00583715)))));
}

float computeAO(vec2 uv_3) {
    float occ = 0.0;
    int s = 0;
    int t = 0;
    bool local = false;
    bool local_1 = false;
    vec4 _e1 = loadG(uv_3);
    float _e3 = unpack16_(_e1.zw);
    if ((_e3 >= 0.9999)) {
        return 1.0;
    }
    vec3 _e8 = octDecode(_e1.xy);
    vec3 _e9 = viewPos(uv_3, _e3);
    float radius = _group_0_binding_6_fs.radiusIntBias.x;
    float intensity = _group_0_binding_6_fs.radiusIntBias.y;
    float bias = _group_0_binding_6_fs.radiusIntBias.z;
    float _e25 = _group_0_binding_6_fs.radiusIntBias.w;
    int slices = int(_e25);
    float _e30 = _group_0_binding_6_fs.stepsNearFar.x;
    int steps = int(_e30);
    float invZ = (1.0 / max(0.05, -(_e9.z)));
    float _e41 = _group_0_binding_6_fs.proj.y;
    float _e49 = _group_0_binding_6_fs.proj.z;
    vec2 srUV = vec2((((radius * _e41) * invZ) * 0.5), (((radius * _e49) * invZ) * 0.5));
    vec4 _e57 = _group_0_binding_6_fs.resTexel;
    float _e60 = hash((uv_3 * _e57.xy));
    float rot = ((_e60 * 2.0) * 3.1415927);
    bool loop_init = true;
    while(true) {
        if (!loop_init) {
            int _e133 = s;
            s = (_e133 + 1);
        }
        loop_init = false;
        int _e69 = s;
        if ((_e69 < slices)) {
        } else {
            break;
        }
        {
            int _e71 = s;
            float ang = (rot + (float(_e71) * (6.2831855 / float(slices))));
            vec2 dir = vec2(cos(ang), sin(ang));
            t = 1;
            bool loop_init_1 = true;
            while(true) {
                if (!loop_init_1) {
                    int _e130 = t;
                    t = (_e130 + 1);
                }
                loop_init_1 = false;
                int _e83 = t;
                if ((_e83 <= steps)) {
                } else {
                    break;
                }
                {
                    int _e86 = t;
                    vec2 suv = (uv_3 + ((dir * srUV) * (float(_e86) / float(steps))));
                    if (!(any(lessThan(suv, vec2(0.0))))) {
                        local = any(greaterThan(suv, vec2(1.0)));
                    } else {
                        local = true;
                    }
                    bool _e104 = local;
                    if (_e104) {
                        continue;
                    }
                    vec4 _e105 = loadG(suv);
                    float _e107 = unpack16_(_e105.zw);
                    if ((_e107 >= 0.9999)) {
                        continue;
                    }
                    vec3 _e110 = viewPos(suv, _e107);
                    vec3 dv = (_e110 - _e9);
                    float dist = length(dv);
                    if (!((dist < 0.0001))) {
                        local_1 = (dist > radius);
                    } else {
                        local_1 = true;
                    }
                    bool _e120 = local_1;
                    if (_e120) {
                        continue;
                    }
                    float ndotv = (dot(_e8, dv) / dist);
                    if ((ndotv <= bias)) {
                        continue;
                    }
                    float _e124 = occ;
                    occ = (_e124 + (ndotv * (1.0 - (dist / radius))));
                }
            }
        }
    }
    float _e136 = occ;
    float ao = (1.0 - ((_e136 / float(max((slices * steps), 1))) * intensity));
    return clamp(ao, 0.0, 1.0);
}

void main() {
    VOut in_ = VOut(gl_FragCoord, _vs2fs_location0);
    float _e2 = computeAO(in_.uv);
    _fs2p_location0 = vec4(_e2, _e2, _e2, 1.0);
    return;
}

