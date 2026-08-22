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
struct VOut {
    vec4 pos;
    int shapeType;
    float texIndex;
    vec2 uv;
    vec4 tint;
    vec2 worldPos;
    vec2 center;
    float radius;
    vec2 dash;
    vec2 local;
    vec2 halfExt;
    vec4 radii;
    float strokeWidth;
    vec4 colorFill;
    vec4 colorStroke;
};
layout(std140) uniform Frame_block_0Fragment { Frame _group_0_binding_0_fs; };

layout(std140) uniform Clip_block_1Fragment { Clip _group_0_binding_8_fs; };

uniform highp sampler2D _group_1_binding_0_fs;

uniform highp sampler2D _group_1_binding_1_fs;

flat in int _vs2fs_location0;
flat in float _vs2fs_location1;
smooth in vec2 _vs2fs_location2;
smooth in vec4 _vs2fs_location3;
smooth in vec2 _vs2fs_location4;
flat in vec2 _vs2fs_location5;
flat in float _vs2fs_location6;
flat in vec2 _vs2fs_location7;
smooth in vec2 _vs2fs_location8;
flat in vec2 _vs2fs_location9;
flat in vec4 _vs2fs_location10;
flat in float _vs2fs_location11;
flat in vec4 _vs2fs_location12;
flat in vec4 _vs2fs_location13;
layout(location = 0) out vec4 _fs2p_location0;

float clipRoundBox(vec2 p_1, vec2 b, float rad) {
    vec2 q = ((abs(p_1) - b) + vec2(rad));
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
    vec2 p_3 = (vec2(fragPos.x, fy) - vec2(_e23, _e26));
    float _e32 = _group_0_binding_8_fs.kind;
    if ((_e32 < 1.5)) {
        float _e38 = _group_0_binding_8_fs.r;
        d = (length(p_3) - _e38);
    } else {
        float _e42 = _group_0_binding_8_fs.halfW;
        float _e45 = _group_0_binding_8_fs.halfH;
        float _e49 = _group_0_binding_8_fs.rrRadius;
        float _e50 = clipRoundBox(p_3, vec2(_e42, _e45), _e49);
        d = _e50;
    }
    float _e51 = d;
    float _e52 = d;
    float _e53 = fwidth(_e52);
    return clamp((0.5 - (_e51 / max(_e53, 0.0001))), 0.0, 1.0);
}

float sdRoundBox(vec2 p_2, vec2 b_1, vec4 r) {
    vec2 rr = ((p_2.x > 0.0) ? r.yz : r.xw);
    float radius = ((p_2.y > 0.0) ? rr.y : rr.x);
    vec2 q_1 = ((abs(p_2) - b_1) + vec2(radius));
    return ((min(max(q_1.x, q_1.y), 0.0) + length(max(q_1, vec2(0.0)))) - radius);
}

float coverage(float d_1) {
    float _e1 = fwidth(d_1);
    return clamp((0.5 - (d_1 / max(_e1, 0.0001))), 0.0, 1.0);
}

void main() {
    VOut in_ = VOut(gl_FragCoord, _vs2fs_location0, _vs2fs_location1, _vs2fs_location2, _vs2fs_location3, _vs2fs_location4, _vs2fs_location5, _vs2fs_location6, _vs2fs_location7, _vs2fs_location8, _vs2fs_location9, _vs2fs_location10, _vs2fs_location11, _vs2fs_location12, _vs2fs_location13);
    vec4 outColor = vec4(0.0);
    vec4 stroke = vec4(0.0);
    float strokeAlpha = 0.0;
    bool local = false;
    vec4 stroke_1 = vec4(0.0);
    vec4 atlasTexel = texture(_group_1_binding_0_fs, vec2(in_.uv));
    vec4 labelTexel = texture(_group_1_binding_1_fs, vec2(in_.uv));
    float _e12 = sdRoundBox(in_.local, in_.halfExt, in_.radii);
    float _e13 = coverage(_e12);
    float _e19 = coverage((abs(_e12) - (in_.strokeWidth * 0.5)));
    if ((in_.shapeType == 1)) {
        vec2 delta = (in_.worldPos - in_.center);
        float dist = length(delta);
        float fillAlpha = (1.0 - smoothstep((in_.radius - 0.5), (in_.radius + 0.5), dist));
        vec4 fill = (in_.colorFill * fillAlpha);
        if ((in_.strokeWidth > 0.0)) {
            float strokeHalf = (in_.strokeWidth * 0.5);
            float outer = (in_.radius + strokeHalf);
            float inner = (in_.radius - strokeHalf);
            float outerEdge = (1.0 - smoothstep((outer - 0.5), (outer + 0.5), dist));
            float innerEdge = smoothstep((inner - 0.5), (inner + 0.5), dist);
            strokeAlpha = (outerEdge * innerEdge);
            float dashPeriod = in_.dash.y;
            if ((dashPeriod > 0.0)) {
                float _e72 = strokeAlpha;
                local = (_e72 > 0.0);
            } else {
                local = false;
            }
            bool _e76 = local;
            if (_e76) {
                float dashStart = in_.dash.x;
                float dashOnLen = (dashPeriod * 0.5);
                float angle = atan(delta.y, delta.x);
                float wrap = ((angle < 0.0) ? (angle + 6.2831855) : angle);
                float arcPos = (wrap * in_.radius);
                float s = (dashStart + arcPos);
                float phase = (s - (dashPeriod * floor((s / dashPeriod))));
                float off = smoothstep((dashOnLen - 0.5), (dashOnLen + 0.5), phase);
                float _e101 = strokeAlpha;
                strokeAlpha = (_e101 * (1.0 - off));
            }
            float _e106 = strokeAlpha;
            stroke = (in_.colorStroke * _e106);
        }
        vec4 _e108 = stroke;
        float _e110 = stroke.w;
        outColor = (_e108 + (fill * (1.0 - _e110)));
        float _e116 = outColor.w;
        if ((_e116 <= 0.0)) {
            discard;
        }
    } else {
        if ((in_.shapeType == 2)) {
            vec4 fill_1 = (in_.colorFill * _e13);
            if ((in_.strokeWidth > 0.0)) {
                stroke_1 = (in_.colorStroke * _e19);
            }
            vec4 _e132 = stroke_1;
            float _e134 = stroke_1.w;
            outColor = (_e132 + (fill_1 * (1.0 - _e134)));
            float _e140 = outColor.w;
            if ((_e140 <= 0.0)) {
                discard;
            }
        } else {
            vec4 texel = ((in_.texIndex < 0.5) ? atlasTexel : labelTexel);
            outColor = (texel * in_.tint);
        }
    }
    vec4 _e149 = outColor;
    float _e152 = clipCoverage(in_.pos.xy);
    outColor = (_e149 * _e152);
    vec4 _e154 = outColor;
    _fs2p_location0 = _e154;
    return;
}

