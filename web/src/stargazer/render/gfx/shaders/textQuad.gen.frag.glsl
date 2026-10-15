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
    vec4 tint;
};
layout(std140) uniform Frame_block_0Fragment { Frame _group_0_binding_0_fs; };

layout(std140) uniform Clip_block_1Fragment { Clip _group_0_binding_8_fs; };

uniform highp sampler2D _group_1_binding_0_fs;

smooth in vec2 _vs2fs_location0;
smooth in vec4 _vs2fs_location1;
layout(location = 0) out vec4 _fs2p_location0;

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

float clipCoverage(vec2 fragPos) {
    vec3 distanceAndGradient = vec3(0.0);
    float _e3 = _group_0_binding_8_fs.kind;
    if ((_e3 < 0.5)) {
        return 1.0;
    }
    float _e10 = _group_0_binding_0_fs.targetH;
    float _e15 = _group_0_binding_0_fs.fragYFlip;
    float deviceY = ((_e15 > 0.5) ? (_e10 - fragPos.y) : fragPos.y);
    float _e23 = _group_0_binding_8_fs.cx;
    float _e26 = _group_0_binding_8_fs.cy;
    vec2 point_2 = (vec2(fragPos.x, deviceY) - vec2(_e23, _e26));
    float _e32 = _group_0_binding_8_fs.kind;
    if ((_e32 < 1.5)) {
        float _e37 = _group_0_binding_8_fs.r;
        vec3 _e38 = circleDistance(point_2, _e37);
        distanceAndGradient = _e38;
    } else {
        float _e41 = _group_0_binding_8_fs.halfW;
        float _e44 = _group_0_binding_8_fs.halfH;
        vec4 _e48 = _group_0_binding_8_fs.radii;
        vec3 _e49 = roundBoxDistance(point_2, vec2(_e41, _e44), _e48);
        distanceAndGradient = _e49;
    }
    vec3 _e50 = distanceAndGradient;
    float _e57 = distanceChangePerPixel(_e50.yz, vec4(1.0, 0.0, 0.0, 1.0));
    float _e59 = distanceAndGradient.x;
    float _e60 = coverage(_e59, _e57);
    return _e60;
}

void main() {
    VOut in_ = VOut(gl_FragCoord, _vs2fs_location0, _vs2fs_location1);
    vec4 _e4 = texture(_group_1_binding_0_fs, vec2(in_.uv));
    float _e9 = clipCoverage(in_.pos.xy);
    _fs2p_location0 = ((_e4 * in_.tint) * _e9);
    return;
}

