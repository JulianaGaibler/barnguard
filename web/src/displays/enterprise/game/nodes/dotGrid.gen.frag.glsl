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
    float rrRadius;
    float clipPad;
};
struct Params {
    vec4 shape;
    vec4 warn;
    vec4 pulse;
};
struct VOut {
    vec4 pos;
    vec2 uv;
    float alpha;
};
layout(std140) uniform Frame_block_0Fragment { Frame _group_0_binding_0_fs; };

layout(std140) uniform Clip_block_1Fragment { Clip _group_0_binding_8_fs; };

layout(std140) uniform Params_block_2Fragment { Params _group_1_binding_10_fs; };

uniform highp sampler2D _group_1_binding_0_fs;

smooth in vec2 _vs2fs_location0;
flat in float _vs2fs_location1;
layout(location = 0) out vec4 _fs2p_location0;

float clipRoundBox(vec2 p, vec2 b, float rad) {
    vec2 q = ((abs(p) - b) + vec2(rad));
    return ((min(max(q.x, q.y), 0.0) + length(max(q, vec2(0.0)))) - rad);
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
        float _e49 = _group_0_binding_8_fs.rrRadius;
        float _e50 = clipRoundBox(p_1, vec2(_e42, _e45), _e49);
        d = _e50;
    }
    float _e51 = d;
    float _e52 = d;
    float _e53 = fwidth(_e52);
    return clamp((0.5 - (_e51 / max(_e53, 0.0001))), 0.0, 1.0);
}

float dot_(vec2 local, float value, float aa) {
    float _e6 = _group_1_binding_10_fs.shape.z;
    float radius = ((value * _e6) * 0.5);
    float d_1 = (length(local) - radius);
    return ((value > 0.002) ? clamp((0.5 - (d_1 / aa)), 0.0, 1.0) : 0.0);
}

void main() {
    VOut in_ = VOut(gl_FragCoord, _vs2fs_location0, _vs2fs_location1);
    vec4 _e3 = _group_1_binding_10_fs.shape;
    vec2 grid = _e3.xy;
    vec2 g = (in_.uv * grid);
    ivec2 cell = ivec2(clamp(floor(g), vec2(0.0), (grid - vec2(1.0))));
    vec2 local_1 = (fract(g) - vec2(0.5));
    float _e20 = fwidth(g.x);
    float aa_1 = max(_e20, 0.0001);
    vec4 v = texelFetch(_group_1_binding_0_fs, cell, 0);
    float edge = min((min(in_.uv.x, (1.0 - in_.uv.x)) * grid.x), (min(in_.uv.y, (1.0 - in_.uv.y)) * grid.y));
    float _e48 = _group_1_binding_10_fs.shape.w;
    float _e56 = _group_1_binding_10_fs.shape.w;
    float fade = ((_e56 > 0.0) ? smoothstep(0.0, max(_e48, 0.0001), edge) : 1.0);
    float _e63 = dot_(local_1, (v.x * fade), aa_1);
    float _e67 = _group_1_binding_10_fs.warn.w;
    float warnA = (_e63 * _e67);
    float _e71 = dot_(local_1, (v.y * fade), aa_1);
    float _e75 = _group_1_binding_10_fs.pulse.w;
    float pulseA = (_e71 * _e75);
    vec4 _e79 = _group_1_binding_10_fs.pulse;
    vec4 _e84 = _group_1_binding_10_fs.warn;
    vec3 rgb = ((_e79.xyz * pulseA) + ((_e84.xyz * warnA) * (1.0 - pulseA)));
    float a = (pulseA + (warnA * (1.0 - pulseA)));
    float _e99 = clipCoverage(in_.pos.xy);
    _fs2p_location0 = (vec4(rgb, a) * (in_.alpha * _e99));
    return;
}

