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

layout(std140) uniform Frame_block_0Fragment { Frame _group_0_binding_0_fs; };

uniform highp sampler2D _group_1_binding_0_fs;

uniform highp sampler2D _group_1_binding_1_fs;

uniform highp sampler2D _group_1_binding_2_fs;

uniform highp sampler2D _group_1_binding_3_fs;

layout(std140) uniform ShapeParams_block_1Fragment { ShapeParams _group_1_binding_9_fs; };

flat in int _vs2fs_location0;
smooth in vec2 _vs2fs_location1;
flat in vec4 _vs2fs_location2;
flat in vec4 _vs2fs_location3;
flat in vec4 _vs2fs_location4;
flat in vec4 _vs2fs_location5;
flat in vec4 _vs2fs_location6;
flat in vec4 _vs2fs_location7;
flat in vec4 _vs2fs_location8;
flat in vec4 _vs2fs_location9;
flat in vec4 _vs2fs_location10;
flat in vec4 _vs2fs_location11;
flat in vec4 _vs2fs_location12;
layout(location = 0) out vec4 _fs2p_location0;

vec2 devicePos(vec2 fragPos) {
    float _e4 = _group_0_binding_0_fs.targetH;
    float _e9 = _group_0_binding_0_fs.fragYFlip;
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

vec3 cornerFieldSample(vec2 inset, float tile) {
    vec2 withinTile = ((inset - vec2(-1.0)) / vec2(3.0));
    vec2 uv = vec2(withinTile.x, ((tile + withinTile.y) / FIELD_TILES));
    vec4 _e17 = textureLod(_group_1_binding_3_fs, vec2(uv), 0.0);
    return _e17.xyz;
}

vec3 squircleBoxDistance(vec2 point_3, vec2 halfSize_1, vec4 cornerRadii_1, vec4 cornerSmoothing) {
    bool local_3 = false;
    vec2 radiusColumn = ((point_3.x > 0.0) ? cornerRadii_1.yz : cornerRadii_1.xw);
    float cornerRadius_1 = ((point_3.y > 0.0) ? radiusColumn.y : radiusColumn.x);
    vec2 smoothingColumn = ((point_3.x > 0.0) ? cornerSmoothing.yz : cornerSmoothing.xw);
    float smoothing = ((point_3.y > 0.0) ? smoothingColumn.y : smoothingColumn.x);
    if (!((cornerRadius_1 <= 0.0))) {
        local_3 = (smoothing <= 0.0);
    } else {
        local_3 = true;
    }
    bool _e36 = local_3;
    if (_e36) {
        vec3 _e37 = roundBoxDistance(point_3, halfSize_1, cornerRadii_1);
        return _e37;
    }
    vec2 inset_1 = ((halfSize_1 - abs(point_3)) / vec2(cornerRadius_1));
    vec2 quadrantSign_2 = mix(vec2(-1.0), vec2(1.0), greaterThanEqual(point_3, vec2(0.0)));
    if ((min(inset_1.x, inset_1.y) >= 1.9765625)) {
        vec2 nearestSide_1 = ((inset_1.x < inset_1.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0));
        return vec3((-(min(inset_1.x, inset_1.y)) * cornerRadius_1), (quadrantSign_2 * nearestSide_1));
    }
    vec2 sampled = clamp(inset_1, vec2(-0.9765625), vec2(1.9765625));
    float tileStep = (smoothing * 20.0);
    float lowerTile = floor(tileStep);
    float upperTile = min((lowerTile + 1.0), 20.0);
    vec3 _e83 = cornerFieldSample(sampled, lowerTile);
    vec3 _e84 = cornerFieldSample(sampled, upperTile);
    vec3 field = mix(_e83, _e84, (tileStep - lowerTile));
    vec2 insetGradient = (field.yz / vec2(max(length(field.yz), 1e-6)));
    float insetDistance = (field.x + dot(insetGradient, (inset_1 - sampled)));
    return vec3((insetDistance * cornerRadius_1), (-(quadrantSign_2) * insetGradient));
}

vec4 fillColorAt(vec2 dp, vec4 colorFill, vec4 paint) {
    if ((paint.w <= 0.5)) {
        return colorFill;
    }
    float gradT = clamp((dot(dp, paint.xy) - paint.z), 0.0, 1.0);
    float gradU = ((gradT * 0.99609375) + 0.001953125);
    float gradV = (((paint.w - 1.0) + 0.5) / 64.0);
    vec4 _e28 = textureLod(_group_1_binding_2_fs, vec2(vec2(gradU, gradV)), 0.0);
    return (_e28 * colorFill.w);
}

vec4 fillUnderStroke(VOut in_1, vec3 shape_2) {
    vec4 stroke_1 = vec4(0.0);
    float strokeWidth = in_1.paramsA.z;
    float strokeOffset = in_1.paramsA.w;
    float _e8 = distanceChangePerPixel(shape_2.yz, in_1.pixelStep);
    vec2 _e11 = devicePos(in_1.pos.xy);
    vec4 _e14 = fillColorAt(_e11, in_1.colorFill, in_1.paint);
    float _e16 = coverage(shape_2.x, _e8);
    vec4 fill = (_e14 * _e16);
    if ((strokeWidth > 0.0)) {
        float strokeDistance = (abs((shape_2.x - strokeOffset)) - (strokeWidth * 0.5));
        float _e30 = coverage(strokeDistance, _e8);
        stroke_1 = (in_1.colorStroke * _e30);
    }
    vec4 _e32 = stroke_1;
    float _e34 = stroke_1.w;
    return (_e32 + (fill * (1.0 - _e34)));
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
    VOut in_ = VOut(gl_FragCoord, _vs2fs_location0, _vs2fs_location1, _vs2fs_location2, _vs2fs_location3, _vs2fs_location4, _vs2fs_location5, _vs2fs_location6, _vs2fs_location7, _vs2fs_location8, _vs2fs_location9, _vs2fs_location10, _vs2fs_location11, _vs2fs_location12);
    vec4 outColor = vec4(0.0);
    vec4 stroke = vec4(0.0);
    float strokeAlpha = 0.0;
    bool local_1 = false;
    bool local_2 = false;
    vec3 shape = vec3(0.0);
    if ((in_.shapeType == 1)) {
        vec2 center = in_.paramsA.xy;
        float radius_1 = in_.paramsA.z;
        float circStrokeWidth = in_.paramsA.w;
        vec2 circDelta = (in_.varyingPos - center);
        vec3 _e13 = circleDistance(circDelta, radius_1);
        float _e16 = distanceChangePerPixel(_e13.yz, in_.pixelStep);
        vec2 _e19 = devicePos(in_.pos.xy);
        vec4 _e22 = fillColorAt(_e19, in_.colorFill, in_.paint);
        float _e24 = coverage(_e13.x, _e16);
        vec4 fill_1 = (_e22 * _e24);
        if ((circStrokeWidth > 0.0)) {
            float _e36 = coverage((abs(_e13.x) - (circStrokeWidth * 0.5)), _e16);
            strokeAlpha = _e36;
            float dashPeriod = in_.paramsB.y;
            if ((dashPeriod > 0.0)) {
                float _e44 = strokeAlpha;
                local_1 = (_e44 > 0.0);
            } else {
                local_1 = false;
            }
            bool _e48 = local_1;
            if (_e48) {
                float dashStart = in_.paramsB.x;
                float dashOnLen = (dashPeriod * 0.5);
                float angle_1 = atan(circDelta.y, circDelta.x);
                float wrap = ((angle_1 < 0.0) ? (angle_1 + 6.2831855) : angle_1);
                float arcPos = (wrap * radius_1);
                float s_3 = (dashStart + arcPos);
                float phase = (s_3 - (dashPeriod * floor((s_3 / dashPeriod))));
                float off = smoothstep((dashOnLen - 0.5), (dashOnLen + 0.5), phase);
                float _e72 = strokeAlpha;
                strokeAlpha = (_e72 * (1.0 - off));
            }
            float _e77 = strokeAlpha;
            stroke = (in_.colorStroke * _e77);
        }
        vec4 _e79 = stroke;
        float _e81 = stroke.w;
        outColor = (_e79 + (fill_1 * (1.0 - _e81)));
        float _e87 = outColor.w;
        if ((_e87 <= 0.0)) {
            discard;
        }
    } else {
        if (!((in_.shapeType == 2))) {
            local_2 = (in_.shapeType == 4);
        } else {
            local_2 = true;
        }
        bool _e100 = local_2;
        if (_e100) {
            if ((in_.shapeType == 2)) {
                vec3 _e110 = squircleBoxDistance(in_.varyingPos, in_.paramsA.xy, in_.radii, in_.paramsB);
                shape = _e110;
            } else {
                vec3 _e114 = ellipseDistance(in_.varyingPos, in_.paramsA.xy);
                shape = _e114;
            }
            vec3 _e115 = shape;
            vec4 _e116 = fillUnderStroke(in_, _e115);
            outColor = _e116;
            float _e118 = outColor.w;
            if ((_e118 <= 0.0)) {
                discard;
            }
        } else {
            if ((in_.shapeType == 3)) {
                float sigma_3 = in_.paramsA.z;
                float inset_2 = in_.paramsA.w;
                vec2 halfExt_2 = in_.paramsA.xy;
                float grow = ((inset_2 > 0.5) ? -(in_.paramsB.z) : in_.paramsB.z);
                vec4 shadowHasRadius = step(vec4(1e-6), in_.radii);
                vec4 shadowRadii = (shadowHasRadius * max((in_.radii + vec4(grow)), vec4(0.0)));
                vec2 shadowHalfExt = max((halfExt_2 + vec2(grow)), vec2(0.0));
                vec2 shadowLocal = (in_.varyingPos - in_.paramsB.xy);
                vec3 _e158 = roundBoxDistance(shadowLocal, shadowHalfExt, shadowRadii);
                float _e162 = distanceChangePerPixel(_e158.yz, in_.pixelStep);
                float _e163 = coverage(_e158.x, _e162);
                float _e164 = shadowCoverage(shadowLocal, shadowHalfExt, shadowRadii, sigma_3, _e163);
                float shadowCov = ((inset_2 > 0.5) ? (1.0 - _e164) : _e164);
                vec3 _e172 = roundBoxDistance(in_.varyingPos, halfExt_2, in_.radii);
                float _e176 = distanceChangePerPixel(_e172.yz, in_.pixelStep);
                float _e177 = coverage(_e172.x, _e176);
                float mask = ((inset_2 > 0.5) ? _e177 : (1.0 - _e177));
                outColor = (in_.colorFill * (shadowCov * mask));
                float _e187 = outColor.w;
                if ((_e187 <= 0.0)) {
                    discard;
                }
            } else {
                if ((in_.paramsA.x < 0.5)) {
                    vec4 _e198 = textureLod(_group_1_binding_0_fs, vec2(in_.varyingPos), 0.0);
                    outColor = (_e198 * in_.colorFill);
                } else {
                    vec4 _e205 = textureLod(_group_1_binding_1_fs, vec2(in_.varyingPos), 0.0);
                    outColor = (_e205 * in_.colorFill);
                }
            }
        }
    }
    vec4 _e208 = outColor;
    vec2 _e211 = devicePos(in_.pos.xy);
    float _e216 = clipCoverageRec(_e211, in_.clip0_, in_.clip1_, in_.clip2_, in_.clip3_);
    outColor = (_e208 * _e216);
    uint _e221 = _group_1_binding_9_fs.flags.x;
    if ((_e221 == 1u)) {
        outColor = vec4(0.05, 0.0, 0.0, 0.05);
    } else {
        uint _e232 = _group_1_binding_9_fs.flags.x;
        if ((_e232 == 2u)) {
            vec4 _e237 = _group_1_binding_9_fs.debugColor;
            outColor = _e237;
        }
    }
    vec4 _e238 = outColor;
    _fs2p_location0 = _e238;
    return;
}

