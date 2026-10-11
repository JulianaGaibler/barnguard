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
    vec4 _e15 = color;
    vec4 _e26 = texture(_group_0_binding_0_fs, vec2((in_.uv + vec2((-(o.x) * 2.0), 0.0))));
    color = (_e15 + _e26);
    vec4 _e28 = color;
    vec4 _e38 = texture(_group_0_binding_0_fs, vec2((in_.uv + vec2((o.x * 2.0), 0.0))));
    color = (_e28 + _e38);
    vec4 _e40 = color;
    vec4 _e51 = texture(_group_0_binding_0_fs, vec2((in_.uv + vec2(0.0, (-(o.y) * 2.0)))));
    color = (_e40 + _e51);
    vec4 _e53 = color;
    vec4 _e63 = texture(_group_0_binding_0_fs, vec2((in_.uv + vec2(0.0, (o.y * 2.0)))));
    color = (_e53 + _e63);
    vec4 _e65 = color;
    vec4 _e74 = texture(_group_0_binding_0_fs, vec2((in_.uv + vec2(-(o.x), o.y))));
    color = (_e65 + (_e74 * 2.0));
    vec4 _e78 = color;
    vec4 _e86 = texture(_group_0_binding_0_fs, vec2((in_.uv + vec2(o.x, o.y))));
    color = (_e78 + (_e86 * 2.0));
    vec4 _e90 = color;
    vec4 _e100 = texture(_group_0_binding_0_fs, vec2((in_.uv + vec2(-(o.x), -(o.y)))));
    color = (_e90 + (_e100 * 2.0));
    vec4 _e104 = color;
    vec4 _e113 = texture(_group_0_binding_0_fs, vec2((in_.uv + vec2(o.x, -(o.y)))));
    color = (_e104 + (_e113 * 2.0));
    vec4 _e117 = color;
    _fs2p_location0 = (_e117 / vec4(12.0));
    return;
}

