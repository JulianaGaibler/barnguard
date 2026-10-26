#version 300 es

precision highp float;
precision highp int;

struct Frame {
    mat3x3 proj;
    float targetH;
    float fragYFlip;
};
struct Clip {
    float kind;
    float cx;
    float cy;
    float r;
    float halfW;
    float halfH;
    float pad0_;
    float pad1_;
    vec4 radii;
};
struct Params {
    vec4 shape;
    vec4 axis;
    vec4 wave;
    vec4 color;
    vec4 extra;
};
struct VOut {
    vec4 pos;
    vec2 uv;
    float alpha;
};
layout(std140) uniform Frame_block_0Fragment { Frame _group_0_binding_0_fs; };

layout(std140) uniform Clip_block_1Fragment { Clip _group_0_binding_8_fs; };

layout(std140) uniform Params_block_2Fragment { Params _group_1_binding_10_fs; };

smooth in vec2 _vs2fs_location0;
flat in float _vs2fs_location1;
layout(location = 0) out vec4 _fs2p_location0;

float clipRoundBox(vec2 p, vec2 b, vec4 radii) {
    vec2 column = ((p.x > 0.0) ? radii.yz : radii.xw);
    float rad = ((p.y > 0.0) ? column.y : column.x);
    vec2 q_1 = ((abs(p) - b) + vec2(rad));
    return ((min(max(q_1.x, q_1.y), 0.0) + length(max(q_1, vec2(0.0)))) - rad);
}

float clipCoverage(vec2 fragPos) {
    float d = 0.0;
    float _e3 = _group_0_binding_8_fs.kind;
    if ((_e3 < 0.5)) {
        return 1.0;
    }
    float _e10 = _group_0_binding_0_fs.targetH;
    float _e15 = _group_0_binding_0_fs.fragYFlip;
    float fy = ((_e15 > 0.5) ? (_e10 - fragPos.y) : fragPos.y);
    float _e23 = _group_0_binding_8_fs.cx;
    float _e26 = _group_0_binding_8_fs.cy;
    vec2 p_1 = (vec2(fragPos.x, fy) - vec2(_e23, _e26));
    float _e32 = _group_0_binding_8_fs.kind;
    if ((_e32 < 1.5)) {
        float _e38 = _group_0_binding_8_fs.r;
        d = (length(p_1) - _e38);
    } else {
        float _e42 = _group_0_binding_8_fs.halfW;
        float _e45 = _group_0_binding_8_fs.halfH;
        vec4 _e49 = _group_0_binding_8_fs.radii;
        float _e50 = clipRoundBox(p_1, vec2(_e42, _e45), _e49);
        d = _e50;
    }
    float _e51 = d;
    float _e52 = d;
    float _e53 = fwidth(_e52);
    return clamp((0.5 - (_e51 / max(_e53, 0.0001))), 0.0, 1.0);
}

float edgeLine(vec2 q, float side, float halfSweep, float inner, float reach, float px) {
    vec2 dir = vec2(cos(halfSweep), (side * sin(halfSweep)));
    float t = dot(q, dir);
    float dist = length((q - (dir * clamp(t, inner, reach))));
    float _e18 = _group_1_binding_10_fs.extra.w;
    float halfWidth = (0.5 * _e18);
    float cov = clamp((((halfWidth - dist) / px) + 0.5), 0.0, 1.0);
    float fade = (1.0 - clamp(((t - inner) / max((reach - inner), 0.0001)), 0.0, 1.0));
    return (cov * fade);
}

void main() {
    VOut in_ = VOut(gl_FragCoord, _vs2fs_location0, _vs2fs_location1);
    bool local = false;
    bool local_1 = false;
    float len = _group_1_binding_10_fs.shape.x;
    float halfSweep_1 = _group_1_binding_10_fs.shape.y;
    float pitch = _group_1_binding_10_fs.shape.z;
    vec4 _e15 = _group_1_binding_10_fs.axis;
    vec2 axis = _e15.xy;
    vec2 p_2 = (((in_.uv * 2.0) - vec2(1.0)) * len);
    vec2 q_2 = vec2(dot(p_2, axis), dot(p_2, vec2(-(axis.y), axis.x)));
    vec2 g = (q_2 / vec2(pitch));
    vec2 cell = roundEven(g);
    vec2 local_2 = (g - cell);
    float _e36 = fwidth(g.x);
    float aa = max(_e36, 0.0001);
    vec2 c = (cell * pitch);
    float r = length(c);
    float inner_1 = _group_1_binding_10_fs.extra.x;
    float _e48 = _group_1_binding_10_fs.axis.z;
    float reach_1 = (len * _e48);
    if ((r > inner_1)) {
        local = (r <= reach_1);
    } else {
        local = false;
    }
    bool _e55 = local;
    if (_e55) {
        local_1 = (abs(atan(c.y, c.x)) <= halfSweep_1);
    } else {
        local_1 = false;
    }
    bool inside = local_1;
    float along = clamp(((r - inner_1) / max((len - inner_1), 0.0001)), 0.0, 1.0);
    float _e76 = _group_1_binding_10_fs.wave.z;
    float rest = max(mix(1.0, _e76, along), 0.0);
    float _e84 = _group_1_binding_10_fs.wave.x;
    float _e89 = _group_1_binding_10_fs.axis.w;
    float _e101 = _group_1_binding_10_fs.wave.w;
    float crest = pow((0.5 + (0.5 * cos((6.2831855 * ((r / _e84) + _e89))))), _e101);
    float _e106 = _group_1_binding_10_fs.wave.y;
    float _e114 = _group_1_binding_10_fs.extra.y;
    float size = ((rest * (1.0 + (_e106 * crest))) + (_e114 * crest));
    float ceiling = _group_1_binding_10_fs.extra.z;
    float _e126 = _group_1_binding_10_fs.shape.w;
    float radius = ((0.5 * ceiling) * tanh(((_e126 * size) / ceiling)));
    float d_1 = (length(local_2) - radius);
    float cov_1 = (inside ? clamp((0.5 - (d_1 / aa)), 0.0, 1.0) : 0.0);
    float px_1 = (aa * pitch);
    float _e143 = edgeLine(q_2, 1.0, halfSweep_1, inner_1, reach_1, px_1);
    float _e145 = edgeLine(q_2, -1.0, halfSweep_1, inner_1, reach_1, px_1);
    float line = max(_e143, _e145);
    float _e154 = _group_1_binding_10_fs.color.w;
    float a = ((line + (cov_1 * (1.0 - line))) * _e154);
    vec4 _e158 = _group_1_binding_10_fs.color;
    float _e165 = clipCoverage(in_.pos.xy);
    _fs2p_location0 = (vec4((_e158.xyz * a), a) * (in_.alpha * _e165));
    return;
}

