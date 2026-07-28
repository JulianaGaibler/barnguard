#version 300 es

precision highp float;
precision highp int;

struct Params {
    vec4 p0_;
    vec4 p1_;
};
struct VOut {
    vec4 pos;
    vec2 uv;
};
const float W0_ = 0.375;
const float W1_ = 0.25;
const float W2_ = 0.0625;

layout(std140) uniform Params_block_0Fragment { Params _group_0_binding_6_fs; };

uniform highp sampler2D _group_0_binding_0_fs;

smooth in vec2 _vs2fs_location0;
layout(location = 0) out vec4 _fs2p_location0;

void main() {
    VOut in_ = VOut(gl_FragCoord, _vs2fs_location0);
    vec4 sum = vec4(0.0);
    vec4 _e3 = _group_0_binding_6_fs.p0_;
    vec2 dir = _e3.xy;
    float radius = _group_0_binding_6_fs.p0_.z;
    float softness = _group_0_binding_6_fs.p0_.w;
    float strength = _group_0_binding_6_fs.p1_.x;
    float d = distance(in_.uv, vec2(0.5));
    float amt = smoothstep(radius, (radius + softness), d);
    vec2 off = (dir * (strength * amt));
    vec4 _e28 = texture(_group_0_binding_0_fs, vec2(in_.uv));
    sum = (_e28 * W0_);
    vec4 _e32 = sum;
    vec4 _e37 = texture(_group_0_binding_0_fs, vec2((in_.uv + off)));
    vec4 _e42 = texture(_group_0_binding_0_fs, vec2((in_.uv - off)));
    sum = (_e32 + ((_e37 + _e42) * W1_));
    vec4 _e47 = sum;
    vec4 _e54 = texture(_group_0_binding_0_fs, vec2((in_.uv + (off * 2.0))));
    vec4 _e61 = texture(_group_0_binding_0_fs, vec2((in_.uv - (off * 2.0))));
    sum = (_e47 + ((_e54 + _e61) * W2_));
    vec4 _e66 = sum;
    _fs2p_location0 = _e66;
    return;
}

