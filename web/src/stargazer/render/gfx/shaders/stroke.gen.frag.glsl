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
struct Stroke {
    float coreOnly;
    float pad0_;
    float pad1_;
    float pad2_;
};
struct VOut {
    vec4 pos;
    vec2 alongPerp;
    float segLen;
    float halfWidth;
    float dashStart;
    float dashPeriod;
    float dashOnLen;
    vec4 color;
    vec2 tangent;
};
const float CORE_MIN_COVERAGE = 0.98;

layout(std140) uniform Frame_block_0Fragment { Frame _group_0_binding_0_fs; };

layout(std140) uniform Clip_block_1Fragment { Clip _group_0_binding_8_fs; };

layout(std140) uniform Stroke_block_2Fragment { Stroke _group_1_binding_2_fs; };

smooth in vec2 _vs2fs_location0;
flat in float _vs2fs_location1;
flat in float _vs2fs_location2;
flat in float _vs2fs_location3;
flat in float _vs2fs_location4;
flat in float _vs2fs_location5;
flat in vec4 _vs2fs_location6;
flat in vec2 _vs2fs_location7;
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
    VOut in_ = VOut(gl_FragCoord, _vs2fs_location0, _vs2fs_location1, _vs2fs_location2, _vs2fs_location3, _vs2fs_location4, _vs2fs_location5, _vs2fs_location6, _vs2fs_location7);
    vec2 offset = vec2(0.0);
    float alpha = 0.0;
    bool local = false;
    float along = in_.alongPerp.x;
    float perp = in_.alongPerp.y;
    offset = vec2(0.0, perp);
    if ((along < 0.0)) {
        offset = vec2(along, perp);
    } else {
        if ((along > in_.segLen)) {
            offset = vec2((along - in_.segLen), perp);
        }
    }
    vec2 _e16 = offset;
    float dist = length(_e16);
    vec2 _e21 = offset;
    vec2 localGradient = ((dist > 1e-6) ? (_e21 / vec2(dist)) : vec2(0.0, 1.0));
    vec2 normal = vec2(-(in_.tangent.y), in_.tangent.x);
    vec2 screenGradient = ((in_.tangent * localGradient.x) + (normal * localGradient.y));
    float _e44 = distanceChangePerPixel(screenGradient, vec4(1.0, 0.0, 0.0, 1.0));
    float _e47 = coverage((dist - in_.halfWidth), _e44);
    alpha = _e47;
    if ((in_.dashPeriod > 0.0)) {
        float dashAlong = clamp(along, 0.0, in_.segLen);
        float s = (in_.dashStart + dashAlong);
        float phase = (s - (in_.dashPeriod * floor((s / in_.dashPeriod))));
        float off = smoothstep((in_.dashOnLen - 0.5), (in_.dashOnLen + 0.5), phase);
        float _e70 = alpha;
        alpha = (_e70 * (1.0 - off));
    }
    float _e74 = alpha;
    if ((_e74 <= 0.0)) {
        discard;
    }
    float _e79 = _group_1_binding_2_fs.coreOnly;
    if ((_e79 > 0.5)) {
        float _e84 = alpha;
        local = (_e84 < CORE_MIN_COVERAGE);
    } else {
        local = false;
    }
    bool _e88 = local;
    if (_e88) {
        discard;
    }
    float _e90 = alpha;
    float _e93 = clipCoverage(in_.pos.xy);
    _fs2p_location0 = (in_.color * (_e90 * _e93));
    return;
}

