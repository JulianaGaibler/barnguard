#version 300 es

precision highp float;
precision highp int;

struct Frame {
    mat3x3 proj;
    float targetH;
    float fragYFlip;
};
struct DrawParams {
    vec4 debugColor;
    vec4 paint;
    vec4 misc;
    uvec4 flags;
    vec4 paintMap;
};
struct VOut {
    vec4 pos;
    vec4 color;
    vec2 uv;
    vec4 clip0_;
    vec4 clip1_;
    vec4 clip2_;
    vec4 clip3_;
};
const float BAYER8_[64] = float[64](0.0, 32.0, 8.0, 40.0, 2.0, 34.0, 10.0, 42.0, 48.0, 16.0, 56.0, 24.0, 50.0, 18.0, 58.0, 26.0, 12.0, 44.0, 4.0, 36.0, 14.0, 46.0, 6.0, 38.0, 60.0, 28.0, 52.0, 20.0, 62.0, 30.0, 54.0, 22.0, 3.0, 35.0, 11.0, 43.0, 1.0, 33.0, 9.0, 41.0, 51.0, 19.0, 59.0, 27.0, 49.0, 17.0, 57.0, 25.0, 15.0, 47.0, 7.0, 39.0, 13.0, 45.0, 5.0, 37.0, 63.0, 31.0, 55.0, 23.0, 61.0, 29.0, 53.0, 21.0);

layout(std140) uniform Frame_block_0Fragment { Frame _group_0_binding_0_fs; };

layout(std140) uniform DrawParams_block_1Fragment { DrawParams _group_1_binding_2_fs; };

uniform highp sampler2D _group_1_binding_1_fs;

uniform highp sampler2D _group_1_binding_3_fs;

uniform highp sampler2D _group_1_binding_4_fs;

smooth in vec4 _vs2fs_location0;
smooth in vec2 _vs2fs_location1;
flat in vec4 _vs2fs_location2;
flat in vec4 _vs2fs_location3;
flat in vec4 _vs2fs_location4;
flat in vec4 _vs2fs_location5;
layout(location = 0) out vec4 _fs2p_location0;

vec2 devicePos(vec2 fragPos) {
    float _e4 = _group_0_binding_0_fs.targetH;
    float _e9 = _group_0_binding_0_fs.fragYFlip;
    float fy = ((_e9 > 0.5) ? (_e4 - fragPos.y) : fragPos.y);
    return vec2(fragPos.x, fy);
}

vec3 circleDistance(vec2 point, float radius) {
    float fromCenter = length(point);
    vec2 direction = ((fromCenter > 1e-6) ? (point / vec2(fromCenter)) : vec2(1.0, 0.0));
    return vec3((fromCenter - radius), direction);
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

float clipCoverageRec(vec2 devicePixel, vec4 shape, vec4 box, vec4 deviceToLocal, vec4 deviceToLocalOffset) {
    vec3 distanceAndGradient = vec3(0.0);
    if ((shape.x < 0.5)) {
        return 1.0;
    }
    vec2 local_1 = vec2((((deviceToLocal.x * devicePixel.x) + (deviceToLocal.z * devicePixel.y)) + deviceToLocalOffset.x), (((deviceToLocal.y * devicePixel.x) + (deviceToLocal.w * devicePixel.y)) + deviceToLocalOffset.y));
    vec2 point_2 = (local_1 - shape.yz);
    if ((shape.x < 1.5)) {
        vec3 _e35 = circleDistance(point_2, shape.w);
        distanceAndGradient = _e35;
    } else {
        vec4 cornerRadii_1 = vec4(box.zw, deviceToLocalOffset.zw);
        vec3 _e40 = roundBoxDistance(point_2, box.xy, cornerRadii_1);
        distanceAndGradient = _e40;
    }
    vec3 _e41 = distanceAndGradient;
    float _e43 = distanceChangePerPixel(_e41.yz, deviceToLocal);
    float _e45 = distanceAndGradient.x;
    float _e46 = coverage(_e45, _e43);
    return _e46;
}

float bayerValue(vec2 fragPos_1) {
    ivec2 xy = (ivec2(fragPos_1) & ivec2(7, 7));
    return (BAYER8_[((xy.y * 8) + xy.x)] / 64.0);
}

ivec2 dt_texel(uint i) {
    return ivec2(int((i % 1024u)), int((i / 1024u)));
}

void main() {
    VOut in_ = VOut(gl_FragCoord, _vs2fs_location0, _vs2fs_location1, _vs2fs_location2, _vs2fs_location3, _vs2fs_location4, _vs2fs_location5);
    vec4 c = vec4(0.0);
    bool local = false;
    uint paintMode = _group_1_binding_2_fs.flags.z;
    if ((paintMode == 1u)) {
        vec2 _e10 = devicePos(in_.pos.xy);
        vec4 _e13 = _group_1_binding_2_fs.paint;
        float _e19 = _group_1_binding_2_fs.paint.z;
        float t = clamp((dot(_e10, _e13.xy) - _e19), 0.0, 1.0);
        float u = ((t * 0.99609375) + 0.001953125);
        float _e31 = _group_1_binding_2_fs.paint.w;
        float v = ((_e31 + 0.5) / 64.0);
        vec4 _e39 = texture(_group_1_binding_3_fs, vec2(vec2(u, v)));
        float _e43 = _group_1_binding_2_fs.misc.y;
        c = (_e39 * _e43);
    } else {
        if ((paintMode == 3u)) {
            vec2 _e49 = devicePos(in_.pos.xy);
            vec4 _e52 = _group_1_binding_2_fs.paint;
            vec4 _e57 = _group_1_binding_2_fs.paint;
            vec4 _e63 = _group_1_binding_2_fs.paintMap;
            vec2 d = (vec2(dot(_e49, _e52.xy), dot(_e49, _e57.zw)) + _e63.xy);
            vec4 _e68 = _group_1_binding_2_fs.paintMap;
            vec2 e = _e68.zw;
            float a = min((dot(e, e) - 1.0), -0.0001);
            float de = dot(d, e);
            float disc = max(((de * de) - (a * dot(d, d))), 0.0);
            float t_1 = clamp(((de - sqrt(disc)) / a), 0.0, 1.0);
            float u_1 = ((t_1 * 0.99609375) + 0.001953125);
            float _e95 = _group_1_binding_2_fs.misc.z;
            float v_1 = ((_e95 + 0.5) / 64.0);
            vec4 _e103 = texture(_group_1_binding_3_fs, vec2(vec2(u_1, v_1)));
            float _e107 = _group_1_binding_2_fs.misc.y;
            c = (_e103 * _e107);
        } else {
            c = in_.color;
        }
    }
    if ((paintMode == 2u)) {
        vec2 _e114 = devicePos(in_.pos.xy);
        vec4 _e117 = _group_1_binding_2_fs.paint;
        vec4 _e122 = _group_1_binding_2_fs.paint;
        vec4 _e128 = _group_1_binding_2_fs.misc;
        vec2 uv = (vec2(dot(_e114, _e117.xy), dot(_e114, _e122.zw)) + _e128.xy);
        if (all(greaterThanEqual(uv, vec2(0.0)))) {
            local = all(lessThanEqual(uv, vec2(1.0)));
        } else {
            local = false;
        }
        bool uvInside = local;
        vec4 _e145 = texture(_group_1_binding_4_fs, vec2(uv));
        float maskR = (uvInside ? _e145.x : 0.0);
        vec4 _e149 = c;
        c = (_e149 * (1.0 - maskR));
    }
    uint _e156 = _group_1_binding_2_fs.flags.x;
    if ((_e156 > 0u)) {
        vec4 _e159 = c;
        vec4 _e163 = texture(_group_1_binding_1_fs, vec2(in_.uv));
        c = (_e159 * _e163.w);
    }
    vec4 _e166 = c;
    vec2 _e169 = devicePos(in_.pos.xy);
    float _e174 = clipCoverageRec(_e169, in_.clip0_, in_.clip1_, in_.clip2_, in_.clip3_);
    c = (_e166 * _e174);
    uint _e179 = _group_1_binding_2_fs.flags.w;
    if ((_e179 > 0u)) {
        float _e184 = bayerValue(in_.pos.xy);
        float _e190 = c.w;
        float noise = (((_e184 - 0.5) / 256.0) * _e190);
        vec4 _e192 = c;
        float _e197 = c.w;
        float _e201 = c.w;
        c = vec4(min((_e192.xyz + vec3(noise)), vec3(_e197)), _e201);
    }
    uint mode = _group_1_binding_2_fs.flags.y;
    if ((mode == 1u)) {
        c = vec4(0.05, 0.0, 0.0, 0.05);
    } else {
        if ((mode == 2u)) {
            vec4 _e218 = _group_1_binding_2_fs.debugColor;
            c = _e218;
        }
    }
    vec4 _e219 = c;
    _fs2p_location0 = _e219;
    return;
}

