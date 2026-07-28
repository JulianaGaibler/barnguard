#version 300 es

precision highp float;
precision highp int;

struct Params {
    vec4 vig;
};
struct VOut {
    vec4 pos;
    vec2 uv;
};
layout(std140) uniform Params_block_0Fragment { Params _group_0_binding_6_fs; };

uniform highp sampler2D _group_0_binding_0_fs;

smooth in vec2 _vs2fs_location0;
layout(location = 0) out vec4 _fs2p_location0;

void main() {
    VOut in_ = VOut(gl_FragCoord, _vs2fs_location0);
    vec4 src = texture(_group_0_binding_0_fs, vec2(in_.uv));
    float d = distance(in_.uv, vec2(0.5));
    float _e12 = _group_0_binding_6_fs.vig.x;
    float _e16 = _group_0_binding_6_fs.vig.y;
    float _e20 = _group_0_binding_6_fs.vig.y;
    float _e24 = _group_0_binding_6_fs.vig.z;
    float v = (1.0 - (_e12 * smoothstep(_e16, (_e20 + _e24), d)));
    _fs2p_location0 = (src * v);
    return;
}

