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
layout(std140) uniform Frame_block_0Vertex { Frame _group_0_binding_0_vs; };

layout(location = 0) in vec2 _p2vs_location0;
layout(location = 1) in vec2 _p2vs_location1;
layout(location = 2) in vec2 _p2vs_location2;
layout(location = 3) in vec2 _p2vs_location3;
layout(location = 4) in vec4 _p2vs_location4;
layout(location = 5) in vec4 _p2vs_location5;
layout(location = 6) in vec4 _p2vs_location6;
layout(location = 7) in vec4 _p2vs_location7;
layout(location = 8) in vec4 _p2vs_location8;
layout(location = 9) in vec4 _p2vs_location9;
layout(location = 10) in vec4 _p2vs_location10;
flat out int _vs2fs_location0;
smooth out vec2 _vs2fs_location1;
flat out vec4 _vs2fs_location2;
flat out vec4 _vs2fs_location3;
flat out vec4 _vs2fs_location4;
flat out vec4 _vs2fs_location5;
flat out vec4 _vs2fs_location6;
flat out vec4 _vs2fs_location7;

float clipRoundBox(vec2 p_1, vec2 b, float rad) {
    vec2 q = ((abs(p_1) - b) + vec2(rad));
    return ((min(max(q.x, q.y), 0.0) + length(max(q, vec2(0.0)))) - rad);
}

vec2 devicePos(vec2 fragPos) {
    float _e4 = _group_0_binding_0_vs.targetH;
    float _e9 = _group_0_binding_0_vs.fragYFlip;
    float fy = ((_e9 > 0.5) ? (_e4 - fragPos.y) : fragPos.y);
    return vec2(fragPos.x, fy);
}

float sdRoundBox(vec2 p_2, vec2 b_1, vec4 r) {
    vec2 rr = ((p_2.x > 0.0) ? r.yz : r.xw);
    float radius = ((p_2.y > 0.0) ? rr.y : rr.x);
    vec2 q_1 = ((abs(p_2) - b_1) + vec2(radius));
    return ((min(max(q_1.x, q_1.y), 0.0) + length(max(q_1, vec2(0.0)))) - radius);
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
    vec2 a_unit = _p2vs_location0;
    vec2 a_mCol0_ = _p2vs_location1;
    vec2 a_mCol1_ = _p2vs_location2;
    vec2 a_mTranslate = _p2vs_location3;
    vec4 a_shape = _p2vs_location4;
    vec4 a_params = _p2vs_location5;
    vec4 a_radii = _p2vs_location6;
    vec4 a_srcRect = _p2vs_location7;
    vec4 a_colorFill = _p2vs_location8;
    vec4 a_colorStroke = _p2vs_location9;
    vec4 a_paint = _p2vs_location10;
    VOut out_ = VOut(vec4(0.0), 0, vec2(0.0), vec4(0.0), vec4(0.0), vec4(0.0), vec4(0.0), vec4(0.0), vec4(0.0));
    vec2 p = vec2(0.0);
    int shape = int((a_shape.x + 0.5));
    out_.shapeType = shape;
    out_.colorStroke = a_colorStroke;
    out_.paint = a_paint;
    if ((shape == 1)) {
        float radius_1 = a_params.x;
        float strokeWidth = a_params.y;
        float outerRadius = ((radius_1 + (strokeWidth * 0.5)) + 1.0);
        p = (a_mTranslate + (((a_unit - vec2(0.5)) * 2.0) * outerRadius));
        vec2 _e37 = p;
        out_.varyingPos = _e37;
        out_.colorFill = a_colorFill;
        out_.paramsA = vec4(a_mTranslate, radius_1, strokeWidth);
        out_.paramsB = vec4(a_params.zw, 0.0, 0.0);
    } else {
        if ((shape == 2)) {
            vec2 halfExt_2 = a_params.xy;
            float feather = a_shape.y;
            float strokeWidth_1 = a_params.z;
            float strokeOffset = a_params.w;
            float inflate = ((feather + abs(strokeOffset)) + (strokeWidth_1 * 0.5));
            vec2 local_1 = (((a_unit - vec2(0.5)) * 2.0) * (halfExt_2 + vec2(inflate)));
            p = ((a_mTranslate + (a_mCol0_ * local_1.x)) + (a_mCol1_ * local_1.y));
            out_.varyingPos = local_1;
            out_.colorFill = a_colorFill;
            out_.paramsA = vec4(halfExt_2, strokeWidth_1, strokeOffset);
            out_.radii = a_radii;
        } else {
            if ((shape == 3)) {
                vec2 halfExt_3 = a_params.xy;
                float strokeOffset_1 = a_params.w;
                float sigma_3 = max(a_srcRect.x, 0.0);
                float spread = a_srcRect.y;
                vec2 offset = a_srcRect.zw;
                vec2 trueHalfExt = (halfExt_3 + vec2(strokeOffset_1));
                vec2 shadowHalfExt = max((trueHalfExt + vec2(spread)), vec2(0.0));
                float pad = (3.0 * sigma_3);
                vec2 quadHalfExt = (max(trueHalfExt, (shadowHalfExt + vec2(length(offset)))) + vec2(pad));
                vec2 local_2 = (((a_unit - vec2(0.5)) * 2.0) * quadHalfExt);
                p = ((a_mTranslate + (a_mCol0_ * local_2.x)) + (a_mCol1_ * local_2.y));
                out_.varyingPos = local_2;
                out_.colorFill = a_colorFill;
                out_.paramsA = vec4(trueHalfExt, sigma_3, a_shape.w);
                out_.radii = a_radii;
                out_.paramsB = vec4(offset, spread, 0.0);
            } else {
                p = (((a_mCol0_ * a_unit.x) + (a_mCol1_ * a_unit.y)) + a_mTranslate);
                out_.varyingPos = mix(a_srcRect.xy, a_srcRect.zw, a_unit);
                out_.colorFill = a_colorFill;
                out_.paramsA = vec4(a_shape.z, 0.0, 0.0, 0.0);
            }
        }
    }
    mat3x3 _e140 = _group_0_binding_0_vs.proj;
    vec2 _e141 = p;
    vec3 clip = (_e140 * vec3(_e141, 1.0));
    out_.pos = vec4(clip.xy, 0.0, 1.0);
    VOut _e150 = out_;
    gl_Position = _e150.pos;
    _vs2fs_location0 = _e150.shapeType;
    _vs2fs_location1 = _e150.varyingPos;
    _vs2fs_location2 = _e150.colorFill;
    _vs2fs_location3 = _e150.colorStroke;
    _vs2fs_location4 = _e150.paint;
    _vs2fs_location5 = _e150.paramsA;
    _vs2fs_location6 = _e150.radii;
    _vs2fs_location7 = _e150.paramsB;
    return;
}

