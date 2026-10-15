#version 300 es

precision highp float;
precision highp int;

struct Frame {
    mat3x3 proj;
    float targetH;
    float fragYFlip;
};
struct Params {
    float opacity;
    float matteMode;
    float pad0_;
    float pad1_;
};
struct VOut {
    vec4 pos;
    vec2 uv;
};
layout(std140) uniform Params_block_0Fragment { Params _group_1_binding_2_fs; };

uniform highp sampler2D _group_1_binding_1_fs;

uniform highp sampler2D _group_1_binding_3_fs;

smooth in vec2 _vs2fs_location0;
layout(location = 0) out vec4 _fs2p_location0;

void main() {
    VOut in_ = VOut(gl_FragCoord, _vs2fs_location0);
    vec4 c = vec4(0.0);
    float f = 0.0;
    bool local = false;
    bool local_1 = false;
    vec4 _e4 = texture(_group_1_binding_1_fs, vec2(in_.uv));
    c = _e4;
    float mode = _group_1_binding_2_fs.matteMode;
    if ((mode > 0.5)) {
        vec4 m = texture(_group_1_binding_3_fs, vec2(in_.uv));
        f = m.w;
        if ((mode > 2.5)) {
            f = dot(m.xyz, vec3(0.2125, 0.7154, 0.0721));
        }
        if ((mode > 1.5)) {
            local = (mode < 2.5);
        } else {
            local = false;
        }
        bool _e32 = local;
        if (!(_e32)) {
            local_1 = (mode > 3.5);
        } else {
            local_1 = true;
        }
        bool _e39 = local_1;
        if (_e39) {
            float _e40 = f;
            f = (1.0 - _e40);
        }
        vec4 _e43 = c;
        float _e44 = f;
        c = (_e43 * _e44);
    }
    vec4 _e46 = c;
    float _e49 = _group_1_binding_2_fs.opacity;
    _fs2p_location0 = (_e46 * _e49);
    return;
}

