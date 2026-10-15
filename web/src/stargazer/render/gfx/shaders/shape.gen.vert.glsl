#version 300 es

precision highp float;
precision highp int;

struct Frame {
    mat3x3 proj;
    float targetH;
    float fragYFlip;
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
    vec4 clip0_;
    vec4 clip1_;
    vec4 clip2_;
    vec4 clip3_;
    vec4 pixelStep;
};
const float FIELD_TILES = 21.0;
const float FIELD_PATCH_MIN = -1.0;
const float FIELD_PATCH_SPAN = 3.0;
const float FIELD_TEXEL = 0.046875;

layout(std140) uniform Frame_block_0Vertex { Frame _group_0_binding_0_vs; };

uniform highp sampler2D _group_0_binding_10_vs;

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
layout(location = 11) in uint _p2vs_location11;
flat out int _vs2fs_location0;
smooth out vec2 _vs2fs_location1;
flat out vec4 _vs2fs_location2;
flat out vec4 _vs2fs_location3;
flat out vec4 _vs2fs_location4;
flat out vec4 _vs2fs_location5;
flat out vec4 _vs2fs_location6;
flat out vec4 _vs2fs_location7;
flat out vec4 _vs2fs_location8;
flat out vec4 _vs2fs_location9;
flat out vec4 _vs2fs_location10;
flat out vec4 _vs2fs_location11;
flat out vec4 _vs2fs_location12;

vec2 devicePos(vec2 fragPos) {
    float _e4 = _group_0_binding_0_vs.targetH;
    float _e9 = _group_0_binding_0_vs.fragYFlip;
    float fy = ((_e9 > 0.5) ? (_e4 - fragPos.y) : fragPos.y);
    return vec2(fragPos.x, fy);
}

vec3 circleDistance(vec2 point, float radius) {
    float fromCenter = length(point);
    vec2 direction_1 = ((fromCenter > 1e-6) ? (point / vec2(fromCenter)) : vec2(1.0, 0.0));
    return vec3((fromCenter - radius), direction_1);
}

vec3 roundBoxDistance(vec2 point_1, vec2 halfSize, vec4 cornerRadii) {
    vec2 column = ((point_1.x > 0.0) ? cornerRadii.yz : cornerRadii.xw);
    float cornerRadius = ((point_1.y > 0.0) ? column.y : column.x);
    vec2 fromInnerBox = ((abs(point_1) - halfSize) + vec2(cornerRadius));
    vec2 beyondInnerBox = max(fromInnerBox, vec2(0.0));
    float gapToInnerBox = length(beyondInnerBox);
    bool outsideInnerBox = (max(fromInnerBox.x, fromInnerBox.y) > 0.0);
    vec2 nearestSide = ((fromInnerBox.x > fromInnerBox.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0));
    vec2 foldedDirection = (outsideInnerBox ? (beyondInnerBox / vec2(max(gapToInnerBox, 1e-6))) : nearestSide);
    float distance_1 = ((outsideInnerBox ? gapToInnerBox : max(fromInnerBox.x, fromInnerBox.y)) - cornerRadius);
    vec2 quadrantSign = mix(vec2(-1.0), vec2(1.0), greaterThanEqual(point_1, vec2(0.0)));
    return vec3(distance_1, (quadrantSign * foldedDirection));
}

float distanceChangePerPixel(vec2 gradient, vec4 pixelStep) {
    return (abs(dot(gradient, pixelStep.xy)) + abs(dot(gradient, pixelStep.zw)));
}

float coverage(float distance_, float changePerPixel) {
    return clamp((0.5 - (distance_ / max(changePerPixel, 0.0001))), 0.0, 1.0);
}

float clipCoverageRec(vec2 devicePixel, vec4 shape_1, vec4 box, vec4 deviceToLocal, vec4 deviceToLocalOffset) {
    vec3 distanceAndGradient = vec3(0.0);
    if ((shape_1.x < 0.5)) {
        return 1.0;
    }
    vec2 local_4 = vec2((((deviceToLocal.x * devicePixel.x) + (deviceToLocal.z * devicePixel.y)) + deviceToLocalOffset.x), (((deviceToLocal.y * devicePixel.x) + (deviceToLocal.w * devicePixel.y)) + deviceToLocalOffset.y));
    vec2 point_4 = (local_4 - shape_1.yz);
    if ((shape_1.x < 1.5)) {
        vec3 _e35 = circleDistance(point_4, shape_1.w);
        distanceAndGradient = _e35;
    } else {
        vec4 cornerRadii_2 = vec4(box.zw, deviceToLocalOffset.zw);
        vec3 _e40 = roundBoxDistance(point_4, box.xy, cornerRadii_2);
        distanceAndGradient = _e40;
    }
    vec3 _e41 = distanceAndGradient;
    float _e43 = distanceChangePerPixel(_e41.yz, deviceToLocal);
    float _e45 = distanceAndGradient.x;
    float _e46 = coverage(_e45, _e43);
    return _e46;
}

vec3 ellipseDistance(vec2 point_2, vec2 radii) {
    vec2 nearest = vec2(0.0);
    float cosine = 0.0;
    vec2 direction = vec2(0.0);
    vec2 quadrantSign_1 = mix(vec2(-1.0), vec2(1.0), greaterThanEqual(point_2, vec2(0.0)));
    bool swapped = (abs(point_2.x) > abs(point_2.y));
    vec2 p_2 = (swapped ? abs(point_2).yx : abs(point_2));
    vec2 ab = (swapped ? radii.yx : radii);
    float radiiGap = ((ab.y * ab.y) - (ab.x * ab.x));
    if ((abs(radiiGap) < (1e-6 * max((ab.x * ab.x), (ab.y * ab.y))))) {
        float fromCenter_1 = length(p_2);
        nearest = ((fromCenter_1 > 1e-6) ? (p_2 * (ab.x / fromCenter_1)) : vec2(0.0, ab.x));
    } else {
        float m = ((ab.x * p_2.x) / radiiGap);
        float m2_ = (m * m);
        float n = ((ab.y * p_2.y) / radiiGap);
        float n2_ = (n * n);
        float c = (((m2_ + n2_) - 1.0) / 3.0);
        float c3_ = ((c * c) * c);
        float q = (c3_ + ((m2_ * n2_) * 2.0));
        float discriminant = (c3_ + (m2_ * n2_));
        float g = (m + (m * n2_));
        if ((discriminant < 0.0)) {
            float angle = (acos(clamp((q / c3_), -1.0, 1.0)) / 3.0);
            float s = cos(angle);
            float t = (sin(angle) * 1.7320508);
            float rootX = sqrt(max(0.0, ((-(c) * ((s + t) + 2.0)) + m2_)));
            float rootY = sqrt(max(0.0, ((-(c) * ((s - t) + 2.0)) + m2_)));
            cosine = ((((rootY + (sign(radiiGap) * rootX)) + (abs(g) / max((rootX * rootY), 1e-12))) - m) / 2.0);
        } else {
            float h = (((2.0 * m) * n) * sqrt(discriminant));
            float s_1 = (sign((q + h)) * pow(abs((q + h)), 0.33333334));
            float u = (sign((q - h)) * pow(abs((q - h)), 0.33333334));
            float rootX_1 = (((-(s_1) - u) - (c * 4.0)) + (2.0 * m2_));
            float rootY_1 = ((s_1 - u) * 1.7320508);
            float rootLength = length(vec2(rootX_1, rootY_1));
            cosine = ((((rootY_1 / sqrt(max((rootLength - rootX_1), 1e-12))) + ((2.0 * g) / max(rootLength, 1e-12))) - m) / 2.0);
        }
        float _e165 = cosine;
        cosine = clamp(_e165, 0.0, 1.0);
        float _e169 = cosine;
        float _e170 = cosine;
        float _e171 = cosine;
        nearest = (ab * vec2(_e169, sqrt((1.0 - (_e170 * _e171)))));
    }
    vec2 _e178 = nearest;
    vec2 offset = (p_2 - _e178);
    float gap = length(offset);
    float _e183 = nearest.y;
    bool inside = (p_2.y < _e183);
    vec2 _e185 = nearest;
    vec2 normal = (_e185 / (ab * ab));
    vec2 onOutline = (normal / vec2(max(length(normal), 1e-12)));
    direction = ((gap > 1e-6) ? ((inside ? -(offset) : offset) / vec2(max(gap, 1e-12))) : onOutline);
    vec2 _e203 = direction;
    vec2 _e204 = direction;
    direction = (swapped ? _e204.yx : _e203);
    vec2 _e209 = direction;
    return vec3((inside ? -(gap) : gap), (quadrantSign_1 * _e209));
}

ivec2 dt_texel(uint i) {
    return ivec2(int((i % 1024u)), int((i / 1024u)));
}

float shadowErf(float x) {
    float y = 0.0;
    float s_2 = sign(x);
    float a = abs(x);
    y = (1.0 + ((0.278393 + ((0.230389 + ((0.000972 + (0.078108 * a)) * a)) * a)) * a));
    float _e17 = y;
    float _e18 = y;
    y = (_e17 * _e18);
    float _e20 = y;
    float _e21 = y;
    return (s_2 - (s_2 / (_e20 * _e21)));
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

float shadowCoverage(vec2 p_1, vec2 halfExt_1, vec4 radii_1, float sigma_2, float hardCoverage) {
    float y_2 = 0.0;
    float value = 0.0;
    int i_1 = 0;
    if ((sigma_2 < 0.0001)) {
        return hardCoverage;
    }
    float low = (p_1.y - halfExt_1.y);
    float high = (p_1.y + halfExt_1.y);
    float start = clamp((-3.0 * sigma_2), low, high);
    float end = clamp((3.0 * sigma_2), low, high);
    float step_ = ((end - start) / 4.0);
    y_2 = (start + (step_ * 0.5));
    bool loop_init = true;
    while(true) {
        if (!loop_init) {
            int _e56 = i_1;
            i_1 = (_e56 + 1);
        }
        loop_init = false;
        int _e30 = i_1;
        if ((_e30 < 4)) {
        } else {
            break;
        }
        {
            float _e34 = y_2;
            float rowY = (p_1.y - _e34);
            float cornerL_1 = ((rowY > 0.0) ? radii_1.w : radii_1.x);
            float cornerR_1 = ((rowY > 0.0) ? radii_1.z : radii_1.y);
            float _e46 = value;
            float _e48 = shadowBoxX(p_1.x, rowY, sigma_2, cornerL_1, cornerR_1, halfExt_1);
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
    uint a_param = _p2vs_location11;
    VOut out_ = VOut(vec4(0.0), 0, vec2(0.0), vec4(0.0), vec4(0.0), vec4(0.0), vec4(0.0), vec4(0.0), vec4(0.0), vec4(0.0), vec4(0.0), vec4(0.0), vec4(0.0), vec4(0.0));
    vec2 p = vec2(0.0);
    bool local = false;
    uint rec = (a_param * 4u);
    ivec2 _e18 = dt_texel(uint(rec));
    vec4 _e20 = texelFetch(_group_0_binding_10_vs, _e18, 0);
    out_.clip0_ = _e20;
    ivec2 _e26 = dt_texel(uint((rec + 1u)));
    vec4 _e28 = texelFetch(_group_0_binding_10_vs, _e26, 0);
    out_.clip1_ = _e28;
    ivec2 _e34 = dt_texel(uint((rec + 2u)));
    vec4 _e36 = texelFetch(_group_0_binding_10_vs, _e34, 0);
    out_.clip2_ = _e36;
    ivec2 _e42 = dt_texel(uint((rec + 3u)));
    vec4 _e44 = texelFetch(_group_0_binding_10_vs, _e42, 0);
    out_.clip3_ = _e44;
    int shape_3 = int((a_shape.x + 0.5));
    out_.shapeType = shape_3;
    out_.colorStroke = a_colorStroke;
    out_.paint = a_paint;
    out_.pixelStep = vec4(1.0, 0.0, 0.0, 1.0);
    float determinant_ = ((a_mCol0_.x * a_mCol1_.y) - (a_mCol1_.x * a_mCol0_.y));
    float inverseDeterminant = ((abs(determinant_) > 1e-12) ? (1.0 / determinant_) : 0.0);
    vec4 localStep = (vec4(a_mCol1_.y, -(a_mCol0_.y), -(a_mCol1_.x), a_mCol0_.x) * inverseDeterminant);
    if ((shape_3 == 1)) {
        float radius_1 = a_params.x;
        float strokeWidth = a_params.y;
        float outerRadius = ((radius_1 + (strokeWidth * 0.5)) + 1.0);
        p = (a_mTranslate + (((a_unit - vec2(0.5)) * 2.0) * outerRadius));
        vec2 _e98 = p;
        out_.varyingPos = _e98;
        out_.colorFill = a_colorFill;
        out_.paramsA = vec4(a_mTranslate, radius_1, strokeWidth);
        out_.paramsB = vec4(a_params.zw, 0.0, 0.0);
    } else {
        if (!((shape_3 == 2))) {
            local = (shape_3 == 4);
        } else {
            local = true;
        }
        bool _e115 = local;
        if (_e115) {
            vec2 halfExt_2 = a_params.xy;
            float feather = a_shape.y;
            float strokeWidth_1 = a_params.z;
            float strokeOffset = a_params.w;
            float inflate = ((feather + abs(strokeOffset)) + (strokeWidth_1 * 0.5));
            vec2 local_5 = (((a_unit - vec2(0.5)) * 2.0) * (halfExt_2 + vec2(inflate)));
            p = ((a_mTranslate + (a_mCol0_ * local_5.x)) + (a_mCol1_ * local_5.y));
            out_.varyingPos = local_5;
            out_.colorFill = a_colorFill;
            out_.paramsA = vec4(halfExt_2, strokeWidth_1, strokeOffset);
            out_.radii = a_radii;
            out_.paramsB = a_srcRect;
            out_.pixelStep = localStep;
        } else {
            if ((shape_3 == 3)) {
                vec2 halfExt_3 = a_params.xy;
                float strokeOffset_1 = a_params.w;
                float sigma_3 = max(a_srcRect.x, 0.0);
                float spread = a_srcRect.y;
                vec2 offset_1 = a_srcRect.zw;
                vec2 trueHalfExt = (halfExt_3 + vec2(strokeOffset_1));
                vec2 shadowHalfExt = max((trueHalfExt + vec2(spread)), vec2(0.0));
                float pad = (3.0 * sigma_3);
                vec2 quadHalfExt = (max(trueHalfExt, (shadowHalfExt + vec2(length(offset_1)))) + vec2(pad));
                vec2 local_6 = (((a_unit - vec2(0.5)) * 2.0) * quadHalfExt);
                p = ((a_mTranslate + (a_mCol0_ * local_6.x)) + (a_mCol1_ * local_6.y));
                out_.varyingPos = local_6;
                out_.colorFill = a_colorFill;
                out_.paramsA = vec4(trueHalfExt, sigma_3, a_shape.w);
                out_.radii = a_radii;
                out_.paramsB = vec4(offset_1, spread, 0.0);
                out_.pixelStep = localStep;
            } else {
                p = (((a_mCol0_ * a_unit.x) + (a_mCol1_ * a_unit.y)) + a_mTranslate);
                out_.varyingPos = mix(a_srcRect.xy, a_srcRect.zw, a_unit);
                out_.colorFill = a_colorFill;
                out_.paramsA = vec4(a_shape.z, 0.0, 0.0, 0.0);
            }
        }
    }
    mat3x3 _e211 = _group_0_binding_0_vs.proj;
    vec2 _e212 = p;
    vec3 clip = (_e211 * vec3(_e212, 1.0));
    out_.pos = vec4(clip.xy, 0.0, 1.0);
    VOut _e221 = out_;
    gl_Position = _e221.pos;
    _vs2fs_location0 = _e221.shapeType;
    _vs2fs_location1 = _e221.varyingPos;
    _vs2fs_location2 = _e221.colorFill;
    _vs2fs_location3 = _e221.colorStroke;
    _vs2fs_location4 = _e221.paint;
    _vs2fs_location5 = _e221.paramsA;
    _vs2fs_location6 = _e221.radii;
    _vs2fs_location7 = _e221.paramsB;
    _vs2fs_location8 = _e221.clip0_;
    _vs2fs_location9 = _e221.clip1_;
    _vs2fs_location10 = _e221.clip2_;
    _vs2fs_location11 = _e221.clip3_;
    _vs2fs_location12 = _e221.pixelStep;
    return;
}

