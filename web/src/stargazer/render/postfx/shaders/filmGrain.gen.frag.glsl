#version 300 es

precision highp float;
precision highp int;

struct Params {
    vec4 p0_;
    vec4 tint;
};
struct VOut {
    vec4 pos;
    vec2 uv;
};
layout(std140) uniform Params_block_0Fragment { Params _group_0_binding_6_fs; };

uniform highp sampler2D _group_0_binding_0_fs;

smooth in vec2 _vs2fs_location0;
layout(location = 0) out vec4 _fs2p_location0;

float hash13_(vec3 p) {
    vec3 p3_ = vec3(0.0);
    p3_ = fract((p * 0.1031));
    vec3 _e5 = p3_;
    vec3 _e6 = p3_;
    vec3 _e7 = p3_;
    p3_ = (_e5 + vec3(dot(_e6, (_e7.zyx + vec3(31.32)))));
    float _e16 = p3_.x;
    float _e18 = p3_.y;
    float _e21 = p3_.z;
    return fract(((_e16 + _e18) * _e21));
}

void main() {
    VOut in_ = VOut(gl_FragCoord, _vs2fs_location0);
    vec4 color = texture(_group_0_binding_0_fs, vec2(in_.uv));
    float cellPx = _group_0_binding_6_fs.p0_.x;
    float density = _group_0_binding_6_fs.p0_.y;
    float opacity = _group_0_binding_6_fs.p0_.z;
    float frameIndex = _group_0_binding_6_fs.p0_.w;
    vec2 cell = floor((in_.pos.xy / vec2(cellPx)));
    float _e27 = hash13_(vec3(cell, frameIndex));
    float grain = (step((1.0 - density), _e27) * opacity);
    vec4 _e34 = _group_0_binding_6_fs.tint;
    vec3 tinted = (_e34.xyz * color.w);
    _fs2p_location0 = vec4(mix(color.xyz, tinted, grain), color.w);
    return;
}

