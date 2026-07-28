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
layout(std140) uniform FlatFrame_block_0Fragment { FlatFrame _group_0_binding_1_fs; };

layout(std140) uniform FlatObject_block_1Fragment { FlatObject _group_1_binding_5_fs; };

uniform highp sampler2D _group_1_binding_0_fs;

smooth in vec3 _vs2fs_location0;
smooth in vec3 _vs2fs_location1;
smooth in vec2 _vs2fs_location2;
layout(location = 0) out vec4 _fs2p_location0;

mat3x3 mat3of(mat4x4 m) {
    return mat3x3(m[0].xyz, m[1].xyz, m[2].xyz);
}

vec3 applyFog(vec3 color, vec3 worldPos) {
    float f = 0.0;
    float _e5 = _group_0_binding_1_fs.fogColor.w;
    if ((_e5 < 0.5)) {
        return color;
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
    return mix(color, _e52.xyz, _e54);
}

void main() {
    VOut in_ = VOut(gl_FragCoord, _vs2fs_location0, _vs2fs_location1, _vs2fs_location2);
    vec3 shaded = vec3(0.0);
    bool local = false;
    vec4 tex = texture(_group_1_binding_0_fs, vec2(vec2(in_.uv.x, (1.0 - in_.uv.y))));
    float a = _group_1_binding_5_fs.color.w;
    float debugMode = _group_0_binding_1_fs.debug.x;
    float lit = _group_1_binding_5_fs.flags.x;
    float useTexture = _group_1_binding_5_fs.flags.y;
    if ((debugMode > 1.5)) {
        vec3 n = normalize(in_.normal);
        _fs2p_location0 = vec4((((n * 0.5) + vec3(0.5)) * a), a);
        return;
    }
    if ((useTexture > 0.5)) {
        vec3 straight = ((tex.w > 0.0) ? (tex.xyz / vec3(tex.w)) : tex.xyz);
        vec3 _e50 = applyFog(straight, in_.worldPos);
        float _e58 = _group_1_binding_5_fs.color.w;
        _fs2p_location0 = (vec4((_e50 * tex.w), tex.w) * _e58);
        return;
    }
    vec4 _e62 = _group_1_binding_5_fs.color;
    vec3 base = _e62.xyz;
    if ((lit > 0.5)) {
        local = (debugMode < 0.5);
    } else {
        local = false;
    }
    bool _e72 = local;
    if (_e72) {
        vec3 n_1 = normalize(in_.normal);
        vec4 _e77 = _group_0_binding_1_fs.lightDir;
        float ndl = max(dot(n_1, -(normalize(_e77.xyz))), 0.0);
        vec4 _e86 = _group_0_binding_1_fs.ambient;
        vec4 _e90 = _group_0_binding_1_fs.lightColor;
        shaded = (base * (_e86.xyz + (_e90.xyz * ndl)));
    } else {
        shaded = base;
    }
    vec3 _e95 = shaded;
    vec3 _e97 = applyFog(_e95, in_.worldPos);
    _fs2p_location0 = vec4((_e97 * a), a);
    return;
}

