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
struct VOut {
    vec4 pos;
    vec2 uv;
    float alpha;
    float rampRow;
};
layout(std140) uniform Frame_block_0Vertex { Frame _group_0_binding_0_vs; };

layout(location = 0) in vec2 _p2vs_location0;
layout(location = 1) in vec2 _p2vs_location1;
layout(location = 2) in vec2 _p2vs_location2;
layout(location = 3) in float _p2vs_location3;
smooth out vec2 _vs2fs_location0;
flat out float _vs2fs_location1;
flat out float _vs2fs_location2;

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

void main() {
    vec2 a_unit = _p2vs_location0;
    vec2 a_center = _p2vs_location1;
    vec2 a_radAlpha = _p2vs_location2;
    float a_rampRow = _p2vs_location3;
    VOut out_ = VOut(vec4(0.0), vec2(0.0), 0.0, 0.0);
    float radius_1 = a_radAlpha.x;
    vec2 p = (a_center + (((a_unit - vec2(0.5)) * 2.0) * radius_1));
    mat3x3 _e15 = _group_0_binding_0_vs.proj;
    vec3 clip = (_e15 * vec3(p, 1.0));
    out_.pos = vec4(clip.xy, 0.0, 1.0);
    out_.uv = a_unit;
    out_.alpha = a_radAlpha.y;
    out_.rampRow = a_rampRow;
    VOut _e28 = out_;
    gl_Position = _e28.pos;
    _vs2fs_location0 = _e28.uv;
    _vs2fs_location1 = _e28.alpha;
    _vs2fs_location2 = _e28.rampRow;
    return;
}

