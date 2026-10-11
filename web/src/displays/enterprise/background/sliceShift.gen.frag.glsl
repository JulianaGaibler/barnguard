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
layout(std140) uniform Params_block_0Fragment { Params _group_0_binding_6_fs; };

uniform highp sampler2D _group_0_binding_0_fs;

smooth in vec2 _vs2fs_location0;
layout(location = 0) out vec4 _fs2p_location0;

void main() {
    VOut in_ = VOut(gl_FragCoord, _vs2fs_location0);
    vec2 p = vec2(0.0);
    vec4 _e3 = _group_0_binding_6_fs.p0_;
    vec2 dims = max(_e3.zw, vec2(1.0));
    float cosA = _group_0_binding_6_fs.p0_.x;
    float sinA = _group_0_binding_6_fs.p0_.y;
    mat2x2 forward = mat2x2(vec2(cosA, sinA), vec2(-(sinA), cosA));
    mat2x2 inverse_ = mat2x2(vec2(cosA, -(sinA)), vec2(sinA, cosA));
    vec4 _e26 = _group_0_binding_6_fs.p1_;
    vec2 localCenter = ((_e26.xy * 0.01) * dims);
    float barWidth = _group_0_binding_6_fs.p1_.z;
    float shift = _group_0_binding_6_fs.p1_.w;
    p = (forward * ((in_.uv * dims) - localCenter));
    float _e45 = p.x;
    float sliceIndex = floor(((_e45 / barWidth) + 0.5));
    float _e51 = p.x;
    p.x = (_e51 - ((sliceIndex * barWidth) * shift));
    vec2 _e55 = p;
    vec2 targetUv = (((inverse_ * _e55) + localCenter) / dims);
    vec4 _e62 = texture(_group_0_binding_0_fs, vec2(fract(targetUv)));
    _fs2p_location0 = _e62;
    return;
}

