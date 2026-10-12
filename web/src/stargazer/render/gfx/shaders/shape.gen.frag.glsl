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
struct ShapeParams {
    vec4 debugColor;
    uvec4 flags;
};
struct VOut {
    vec4 pos;
    int shapeType;
    vec2 varyingPos;
    vec4 colorFill;
    vec4 colorStroke;
    vec4 paint;
    vec4 paramsA;
    vec4 radii;
    vec4 paramsB;
};
layout(std140) uniform Frame_block_0Fragment { Frame _group_0_binding_0_fs; };

layout(std140) uniform Clip_block_1Fragment { Clip _group_0_binding_8_fs; };

uniform highp sampler2D _group_1_binding_0_fs;

uniform highp sampler2D _group_1_binding_1_fs;

uniform highp sampler2D _group_1_binding_2_fs;

layout(std140) uniform ShapeParams_block_2Fragment { ShapeParams _group_1_binding_9_fs; };

flat in int _vs2fs_location0;
smooth in vec2 _vs2fs_location1;
flat in vec4 _vs2fs_location2;
flat in vec4 _vs2fs_location3;
flat in vec4 _vs2fs_location4;
flat in vec4 _vs2fs_location5;
flat in vec4 _vs2fs_location6;
flat in vec4 _vs2fs_location7;
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

float shadowCoverage(vec2 p_3, vec2 halfExt_1, vec4 radii, float sigma_2, float hardCoverage) {
    float y_2 = 0.0;
    float value = 0.0;
    int i = 0;
    if ((sigma_2 < 0.0001)) {
        return hardCoverage;
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
            int _e56 = i;
            i = (_e56 + 1);
        }
        loop_init = false;
        int _e30 = i;
        if ((_e30 < 4)) {
        } else {
            break;
        }
        {
            float _e34 = y_2;
            float rowY = (p_3.y - _e34);
            float cornerL_1 = ((rowY > 0.0) ? radii.w : radii.x);
            float cornerR_1 = ((rowY > 0.0) ? radii.z : radii.y);
            float _e46 = value;
            float _e48 = shadowBoxX(p_3.x, rowY, sigma_2, cornerL_1, cornerR_1, halfExt_1);
            float _e49 = y_2;
            float _e50 = shadowGaussian(_e49, sigma_2);
            value = (_e46 + ((_e48 * _e50) * step_));
            float _e54 = y_2;
            y_2 = (_e54 + step_);
        }
    }
    float _e59 = value;
    return _e59;
}

void main() {
    VOut in_ = VOut(gl_FragCoord, _vs2fs_location0, _vs2fs_location1, _vs2fs_location2, _vs2fs_location3, _vs2fs_location4, _vs2fs_location5, _vs2fs_location6, _vs2fs_location7);
    vec4 outColor = vec4(0.0);
    vec4 stroke = vec4(0.0);
    float strokeAlpha = 0.0;
    bool local = false;
    vec4 stroke_1 = vec4(0.0);
    vec4 atlasTexel = texture(_group_1_binding_0_fs, vec2(in_.varyingPos));
    vec4 labelTexel = texture(_group_1_binding_1_fs, vec2(in_.varyingPos));
    bool hasGradient = (in_.paint.w > 0.5);
    vec2 _e15 = devicePos(in_.pos.xy);
    float gradT = clamp((dot(_e15, in_.paint.xy) - in_.paint.z), 0.0, 1.0);
    float gradU = ((gradT * 0.99609375) + 0.001953125);
    float gradV = (((in_.paint.w - 1.0) + 0.5) / 64.0);
    vec4 rampTexel = texture(_group_1_binding_2_fs, vec2(vec2(gradU, gradV)));
    vec4 fillColor = (hasGradient ? (rampTexel * in_.colorFill.w) : in_.colorFill);
    vec2 halfExt_2 = in_.paramsA.xy;
    float _e50 = sdRoundBox(in_.varyingPos, halfExt_2, in_.radii);
    float _e51 = coverage(_e50);
    float strokeWidth = in_.paramsA.z;
    float strokeOffset = in_.paramsA.w;
    float _e61 = coverage((abs((_e50 - strokeOffset)) - (strokeWidth * 0.5)));
    vec2 center = in_.paramsA.xy;
    float radius_1 = in_.paramsA.z;
    vec2 circDelta = (in_.varyingPos - center);
    float circDist = (length(circDelta) - radius_1);
    float _e70 = coverage(circDist);
    float _e77 = coverage((abs(circDist) - (in_.paramsA.w * 0.5)));
    float shadowSpread = in_.paramsB.z;
    vec4 shadowHasRadius = step(vec4(1e-6), in_.radii);
    vec4 shadowRadii = (shadowHasRadius * max((in_.radii + vec4(shadowSpread)), vec4(0.0)));
    vec2 shadowHalfExt = max((halfExt_2 + vec2(shadowSpread)), vec2(0.0));
    vec2 shadowLocal = (in_.varyingPos - in_.paramsB.xy);
    float _e100 = sdRoundBox(shadowLocal, shadowHalfExt, shadowRadii);
    float _e101 = coverage(_e100);
    if ((in_.shapeType == 1)) {
        float circStrokeWidth = in_.paramsA.w;
        vec4 fill = (fillColor * _e70);
        if ((circStrokeWidth > 0.0)) {
            strokeAlpha = _e77;
            float dashPeriod = in_.paramsB.y;
            if ((dashPeriod > 0.0)) {
                float _e121 = strokeAlpha;
                local = (_e121 > 0.0);
            } else {
                local = false;
            }
            bool _e125 = local;
            if (_e125) {
                float dashStart = in_.paramsB.x;
                float dashOnLen = (dashPeriod * 0.5);
                float angle = atan(circDelta.y, circDelta.x);
                float wrap = ((angle < 0.0) ? (angle + 6.2831855) : angle);
                float arcPos = (wrap * radius_1);
                float s_1 = (dashStart + arcPos);
                float phase = (s_1 - (dashPeriod * floor((s_1 / dashPeriod))));
                float off = smoothstep((dashOnLen - 0.5), (dashOnLen + 0.5), phase);
                float _e149 = strokeAlpha;
                strokeAlpha = (_e149 * (1.0 - off));
            }
            float _e154 = strokeAlpha;
            stroke = (in_.colorStroke * _e154);
        }
        vec4 _e156 = stroke;
        float _e158 = stroke.w;
        outColor = (_e156 + (fill * (1.0 - _e158)));
        float _e164 = outColor.w;
        if ((_e164 <= 0.0)) {
            discard;
        }
    } else {
        if ((in_.shapeType == 2)) {
            vec4 fill_1 = (fillColor * _e51);
            if ((strokeWidth > 0.0)) {
                stroke_1 = (in_.colorStroke * _e61);
            }
            vec4 _e178 = stroke_1;
            float _e180 = stroke_1.w;
            outColor = (_e178 + (fill_1 * (1.0 - _e180)));
            float _e186 = outColor.w;
            if ((_e186 <= 0.0)) {
                discard;
            }
        } else {
            if ((in_.shapeType == 3)) {
                float sigma_3 = in_.paramsA.z;
                float inset = in_.paramsA.w;
                float _e196 = shadowCoverage(shadowLocal, shadowHalfExt, shadowRadii, sigma_3, _e101);
                float mask = ((inset > 0.5) ? _e51 : (1.0 - _e51));
                outColor = (in_.colorFill * (_e196 * mask));
                float _e206 = outColor.w;
                if ((_e206 <= 0.0)) {
                    discard;
                }
            } else {
                vec4 texel = ((in_.paramsA.x < 0.5) ? atlasTexel : labelTexel);
                outColor = (texel * in_.colorFill);
            }
        }
    }
    vec4 _e216 = outColor;
    float _e219 = clipCoverage(in_.pos.xy);
    outColor = (_e216 * _e219);
    uint _e224 = _group_1_binding_9_fs.flags.x;
    if ((_e224 == 1u)) {
        outColor = vec4(0.05, 0.0, 0.0, 0.05);
    } else {
        uint _e235 = _group_1_binding_9_fs.flags.x;
        if ((_e235 == 2u)) {
            vec4 _e240 = _group_1_binding_9_fs.debugColor;
            outColor = _e240;
        }
    }
    vec4 _e241 = outColor;
    _fs2p_location0 = _e241;
    return;
}

