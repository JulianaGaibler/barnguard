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
    vec4 paint;
    float strokeOffset;
    vec2 shadowOffset;
    float shadowSpread;
    float shadowSigma;
    float shadowInset;
};
layout(std140) uniform Frame_block_0Fragment { Frame _group_0_binding_0_fs; };

layout(std140) uniform Clip_block_1Fragment { Clip _group_0_binding_8_fs; };

uniform highp sampler2D _group_1_binding_0_fs;

uniform highp sampler2D _group_1_binding_1_fs;

uniform highp sampler2D _group_1_binding_2_fs;

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
flat in vec4 _vs2fs_location14;
flat in float _vs2fs_location15;
flat in vec2 _vs2fs_location16;
flat in float _vs2fs_location17;
flat in float _vs2fs_location18;
flat in float _vs2fs_location19;
layout(location = 0) out vec4 _fs2p_location0;

float clipRoundBox(vec2 p_1, vec2 b, float rad) {
    vec2 q = ((abs(p_1) - b) + vec2(rad));
    return ((min(max(q.x, q.y), 0.0) + length(max(q, vec2(0.0)))) - rad);
}

vec2 devicePos(vec2 fragPos) {
    float _e4 = _group_0_binding_0_fs.targetH;
    float _e9 = _group_0_binding_0_fs.fragYFlip;
    float fy = ((_e9 > 0.5) ? (_e4 - fragPos.y) : fragPos.y);
    return vec2(fragPos.x, fy);
}

float clipCoverage(vec2 fragPos_1) {
    float d = 0.0;
    float _e3 = _group_0_binding_8_fs.kind;
    if ((_e3 < 0.5)) {
        return 1.0;
    }
    vec2 _e7 = devicePos(fragPos_1);
    float _e10 = _group_0_binding_8_fs.cx;
    float _e13 = _group_0_binding_8_fs.cy;
    vec2 p_4 = (_e7 - vec2(_e10, _e13));
    float _e19 = _group_0_binding_8_fs.kind;
    if ((_e19 < 1.5)) {
        float _e25 = _group_0_binding_8_fs.r;
        d = (length(p_4) - _e25);
    } else {
        float _e29 = _group_0_binding_8_fs.halfW;
        float _e32 = _group_0_binding_8_fs.halfH;
        float _e36 = _group_0_binding_8_fs.rrRadius;
        float _e37 = clipRoundBox(p_4, vec2(_e29, _e32), _e36);
        d = _e37;
    }
    float _e38 = d;
    float _e39 = d;
    float _e40 = fwidth(_e39);
    return clamp((0.5 - (_e38 / max(_e40, 0.0001))), 0.0, 1.0);
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

float shadowErf(float x) {
    float y = 0.0;
    float s = sign(x);
    float a = abs(x);
    y = (1.0 + ((0.278393 + ((0.230389 + ((0.000972 + (0.078108 * a)) * a)) * a)) * a));
    float _e17 = y;
    float _e18 = y;
    y = (_e17 * _e18);
    float _e20 = y;
    float _e21 = y;
    return (s - (s / (_e20 * _e21)));
}

float shadowGaussian(float x_1, float sigma) {
    return (exp((-((x_1 * x_1)) / ((2.0 * sigma) * sigma))) / (2.5066283 * sigma));
}

float shadowBoxX(float x_2, float y_1, float sigma_1, float cornerL, float cornerR, vec2 halfExt) {
    float deltaL = min(((halfExt.y - cornerL) - abs(y_1)), 0.0);
    float curvedL = ((halfExt.x - cornerL) + sqrt(max(0.0, ((cornerL * cornerL) - (deltaL * deltaL)))));
    float deltaR = min(((halfExt.y - cornerR) - abs(y_1)), 0.0);
    float curvedR = ((halfExt.x - cornerR) + sqrt(max(0.0, ((cornerR * cornerR) - (deltaR * deltaR)))));
    float invSigma = (0.70710677 / sigma_1);
    float _e40 = shadowErf(((x_2 + curvedL) * invSigma));
    float intHi = (0.5 + (0.5 * _e40));
    float _e47 = shadowErf(((x_2 - curvedR) * invSigma));
    float intLo = (0.5 + (0.5 * _e47));
    return (intHi - intLo);
}

float shadowCoverage(vec2 p_3, vec2 halfExt_1, vec4 radii, float sigma_2) {
    float y_2 = 0.0;
    float value = 0.0;
    int i = 0;
    if ((sigma_2 < 0.0001)) {
        float _e6 = sdRoundBox(p_3, halfExt_1, radii);
        float _e7 = coverage(_e6);
        return _e7;
    }
    float low = (p_3.y - halfExt_1.y);
    float high = (p_3.y + halfExt_1.y);
    float start = clamp((-3.0 * sigma_2), low, high);
    float end = clamp((3.0 * sigma_2), low, high);
    float step_ = ((end - start) / 4.0);
    y_2 = (start + (step_ * 0.5));
    bool loop_init = true;
    while(true) {
        if (!loop_init) {
            int _e57 = i;
            i = (_e57 + 1);
        }
        loop_init = false;
        int _e31 = i;
        if ((_e31 < 4)) {
        } else {
            break;
        }
        {
            float _e35 = y_2;
            float rowY = (p_3.y - _e35);
            float cornerL_1 = ((rowY > 0.0) ? radii.w : radii.x);
            float cornerR_1 = ((rowY > 0.0) ? radii.z : radii.y);
            float _e47 = value;
            float _e49 = shadowBoxX(p_3.x, rowY, sigma_2, cornerL_1, cornerR_1, halfExt_1);
            float _e50 = y_2;
            float _e51 = shadowGaussian(_e50, sigma_2);
            value = (_e47 + ((_e49 * _e51) * step_));
            float _e55 = y_2;
            y_2 = (_e55 + step_);
        }
    }
    float _e60 = value;
    return _e60;
}

void main() {
    VOut in_ = VOut(gl_FragCoord, _vs2fs_location0, _vs2fs_location1, _vs2fs_location2, _vs2fs_location3, _vs2fs_location4, _vs2fs_location5, _vs2fs_location6, _vs2fs_location7, _vs2fs_location8, _vs2fs_location9, _vs2fs_location10, _vs2fs_location11, _vs2fs_location12, _vs2fs_location13, _vs2fs_location14, _vs2fs_location15, _vs2fs_location16, _vs2fs_location17, _vs2fs_location18, _vs2fs_location19);
    vec4 outColor = vec4(0.0);
    vec4 stroke = vec4(0.0);
    float strokeAlpha = 0.0;
    bool local = false;
    vec4 stroke_1 = vec4(0.0);
    vec4 atlasTexel = texture(_group_1_binding_0_fs, vec2(in_.uv));
    vec4 labelTexel = texture(_group_1_binding_1_fs, vec2(in_.uv));
    bool hasGradient = (in_.paint.w > 0.5);
    vec2 _e15 = devicePos(in_.pos.xy);
    float gradT = clamp((dot(_e15, in_.paint.xy) - in_.paint.z), 0.0, 1.0);
    float gradU = ((gradT * 0.99609375) + 0.001953125);
    float gradV = (((in_.paint.w - 1.0) + 0.5) / 64.0);
    vec4 rampTexel = texture(_group_1_binding_2_fs, vec2(vec2(gradU, gradV)));
    vec4 fillColor = (hasGradient ? (rampTexel * in_.colorFill.w) : in_.colorFill);
    float _e49 = sdRoundBox(in_.local, in_.halfExt, in_.radii);
    float _e50 = coverage(_e49);
    float _e58 = coverage((abs((_e49 - in_.strokeOffset)) - (in_.strokeWidth * 0.5)));
    vec2 circDelta = (in_.worldPos - in_.center);
    float circDist = (length(circDelta) - in_.radius);
    float _e65 = coverage(circDist);
    float _e71 = coverage((abs(circDist) - (in_.strokeWidth * 0.5)));
    if ((in_.shapeType == 1)) {
        vec4 fill = (fillColor * _e65);
        if ((in_.strokeWidth > 0.0)) {
            strokeAlpha = _e71;
            float dashPeriod = in_.dash.y;
            if ((dashPeriod > 0.0)) {
                float _e90 = strokeAlpha;
                local = (_e90 > 0.0);
            } else {
                local = false;
            }
            bool _e94 = local;
            if (_e94) {
                float dashStart = in_.dash.x;
                float dashOnLen = (dashPeriod * 0.5);
                float angle = atan(circDelta.y, circDelta.x);
                float wrap = ((angle < 0.0) ? (angle + 6.2831855) : angle);
                float arcPos = (wrap * in_.radius);
                float s_1 = (dashStart + arcPos);
                float phase = (s_1 - (dashPeriod * floor((s_1 / dashPeriod))));
                float off = smoothstep((dashOnLen - 0.5), (dashOnLen + 0.5), phase);
                float _e119 = strokeAlpha;
                strokeAlpha = (_e119 * (1.0 - off));
            }
            float _e124 = strokeAlpha;
            stroke = (in_.colorStroke * _e124);
        }
        vec4 _e126 = stroke;
        float _e128 = stroke.w;
        outColor = (_e126 + (fill * (1.0 - _e128)));
        float _e134 = outColor.w;
        if ((_e134 <= 0.0)) {
            discard;
        }
    } else {
        if ((in_.shapeType == 2)) {
            vec4 fill_1 = (fillColor * _e50);
            if ((in_.strokeWidth > 0.0)) {
                stroke_1 = (in_.colorStroke * _e58);
            }
            vec4 _e149 = stroke_1;
            float _e151 = stroke_1.w;
            outColor = (_e149 + (fill_1 * (1.0 - _e151)));
            float _e157 = outColor.w;
            if ((_e157 <= 0.0)) {
                discard;
            }
        } else {
            if ((in_.shapeType == 3)) {
                vec4 hasRadius = step(vec4(1e-6), in_.radii);
                vec4 shadowRadii = (hasRadius * max((in_.radii + vec4(in_.shadowSpread)), vec4(0.0)));
                vec2 shadowHalfExt = max((in_.halfExt + vec2(in_.shadowSpread)), vec2(0.0));
                vec2 shadowLocal = (in_.local - in_.shadowOffset);
                float _e186 = shadowCoverage(shadowLocal, shadowHalfExt, shadowRadii, in_.shadowSigma);
                float _e190 = sdRoundBox(in_.local, in_.halfExt, in_.radii);
                float _e191 = coverage(_e190);
                float mask = ((in_.shadowInset > 0.5) ? _e191 : (1.0 - _e191));
                outColor = (in_.colorFill * (_e186 * mask));
                float _e202 = outColor.w;
                if ((_e202 <= 0.0)) {
                    discard;
                }
            } else {
                vec4 texel = ((in_.texIndex < 0.5) ? atlasTexel : labelTexel);
                outColor = (texel * in_.tint);
            }
        }
    }
    vec4 _e211 = outColor;
    float _e214 = clipCoverage(in_.pos.xy);
    outColor = (_e211 * _e214);
    vec4 _e216 = outColor;
    _fs2p_location0 = _e216;
    return;
}

