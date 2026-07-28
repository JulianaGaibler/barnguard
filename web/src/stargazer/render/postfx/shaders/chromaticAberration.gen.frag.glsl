#version 300 es

precision highp float;
precision highp int;

struct Params {
    vec4 ca;
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
    float amount = _group_0_binding_6_fs.ca.x;
    vec2 centered = (in_.uv - vec2(0.5));
    vec2 dir = ((centered * amount) * dot(centered, centered));
    vec4 rC = texture(_group_0_binding_0_fs, vec2((in_.uv - dir)));
    vec4 gC = texture(_group_0_binding_0_fs, vec2(in_.uv));
    vec4 bC = texture(_group_0_binding_0_fs, vec2((in_.uv + dir)));
    _fs2p_location0 = vec4(rC.x, gC.y, bC.z, max(rC.w, max(gC.w, bC.w)));
    return;
}

