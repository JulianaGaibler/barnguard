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

layout(std140) uniform Frame_block_0Vertex { Frame _group_0_binding_0_vs; };

uniform highp sampler2D _group_0_binding_10_vs;

layout(location = 0) in vec2 _p2vs_location0;
layout(location = 1) in vec4 _p2vs_location1;
layout(location = 2) in vec2 _p2vs_location2;
layout(location = 3) in uint _p2vs_location3;
smooth out vec4 _vs2fs_location0;
smooth out vec2 _vs2fs_location1;
flat out vec4 _vs2fs_location2;
flat out vec4 _vs2fs_location3;
flat out vec4 _vs2fs_location4;
flat out vec4 _vs2fs_location5;

vec2 devicePos(vec2 fragPos) {
    float _e4 = _group_0_binding_0_vs.targetH;
    float _e9 = _group_0_binding_0_vs.fragYFlip;
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
    vec2 a_pos = _p2vs_location0;
    vec4 a_color = _p2vs_location1;
    vec2 a_uv = _p2vs_location2;
    uint a_param = _p2vs_location3;
    VOut out_ = VOut(vec4(0.0), vec4(0.0), vec2(0.0), vec4(0.0), vec4(0.0), vec4(0.0), vec4(0.0));
    uint rec = (a_param * 4u);
    ivec2 _e10 = dt_texel(uint(rec));
    vec4 _e12 = texelFetch(_group_0_binding_10_vs, _e10, 0);
    out_.clip0_ = _e12;
    ivec2 _e18 = dt_texel(uint((rec + 1u)));
    vec4 _e20 = texelFetch(_group_0_binding_10_vs, _e18, 0);
    out_.clip1_ = _e20;
    ivec2 _e26 = dt_texel(uint((rec + 2u)));
    vec4 _e28 = texelFetch(_group_0_binding_10_vs, _e26, 0);
    out_.clip2_ = _e28;
    ivec2 _e34 = dt_texel(uint((rec + 3u)));
    vec4 _e36 = texelFetch(_group_0_binding_10_vs, _e34, 0);
    out_.clip3_ = _e36;
    mat3x3 _e39 = _group_0_binding_0_vs.proj;
    vec3 clip = (_e39 * vec3(a_pos, 1.0));
    out_.pos = vec4(clip.xy, 0.0, 1.0);
    out_.color = a_color;
    out_.uv = a_uv;
    VOut _e50 = out_;
    gl_Position = _e50.pos;
    _vs2fs_location0 = _e50.color;
    _vs2fs_location1 = _e50.uv;
    _vs2fs_location2 = _e50.clip0_;
    _vs2fs_location3 = _e50.clip1_;
    _vs2fs_location4 = _e50.clip2_;
    _vs2fs_location5 = _e50.clip3_;
    return;
}

