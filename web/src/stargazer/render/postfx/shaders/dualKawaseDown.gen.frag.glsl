#version 300 es

precision highp float;
precision highp int;

struct Params {
    vec4 p0_;
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
    vec4 color = vec4(0.0);
    vec4 _e3 = _group_0_binding_6_fs.p0_;
    float _e10 = _group_0_binding_6_fs.p0_.z;
    vec2 o = ((_e3.xy * 0.5) * _e10);
    vec4 _e15 = texture(_group_0_binding_0_fs, vec2(in_.uv));
    color = (_e15 * 4.0);
    vec4 _e19 = color;
    vec4 _e29 = texture(_group_0_binding_0_fs, vec2((in_.uv + vec2(-(o.x), -(o.y)))));
    color = (_e19 + _e29);
    vec4 _e31 = color;
    vec4 _e40 = texture(_group_0_binding_0_fs, vec2((in_.uv + vec2(o.x, -(o.y)))));
    color = (_e31 + _e40);
    vec4 _e42 = color;
    vec4 _e51 = texture(_group_0_binding_0_fs, vec2((in_.uv + vec2(-(o.x), o.y))));
    color = (_e42 + _e51);
    vec4 _e53 = color;
    vec4 _e61 = texture(_group_0_binding_0_fs, vec2((in_.uv + vec2(o.x, o.y))));
    color = (_e53 + _e61);
    vec4 _e63 = color;
    _fs2p_location0 = (_e63 / vec4(8.0));
    return;
}

