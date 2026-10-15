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
struct ModelColor {
    mat3x3 model;
    vec4 color;
    vec4 paint;
    uvec4 flags;
    vec4 paintOffset;
};
struct VOut {
    vec4 pos;
};
layout(std140) uniform Frame_block_0Vertex { Frame _group_0_binding_0_vs; };

layout(std140) uniform ModelColor_block_1Vertex { ModelColor _group_1_binding_3_vs; };

layout(location = 0) in vec2 _p2vs_location0;

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

vec2 devicePos(vec2 fragPos_1) {
    float _e4 = _group_0_binding_0_vs.targetH;
    float _e9 = _group_0_binding_0_vs.fragYFlip;
    float fy = ((_e9 > 0.5) ? (_e4 - fragPos_1.y) : fragPos_1.y);
    return vec2(fragPos_1.x, fy);
}

void main() {
    vec2 a_pos = _p2vs_location0;
    VOut out_ = VOut(vec4(0.0));
    mat3x3 _e4 = _group_1_binding_3_vs.model;
    vec3 world = (_e4 * vec3(a_pos, 1.0));
    mat3x3 _e10 = _group_0_binding_0_vs.proj;
    vec3 clip = (_e10 * vec3(world.xy, 1.0));
    out_.pos = vec4(clip.xy, 0.0, 1.0);
    VOut _e20 = out_;
    gl_Position = _e20.pos;
    return;
}

