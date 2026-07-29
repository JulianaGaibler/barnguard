#version 300 es

precision highp float;
precision highp int;

struct Frame {
    mat3x3 proj;
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
};
layout(std140) uniform Frame_block_0Vertex { Frame _group_0_binding_0_vs; };

layout(location = 0) in vec2 _p2vs_location0;
layout(location = 1) in vec2 _p2vs_location1;
layout(location = 2) in vec2 _p2vs_location2;
layout(location = 3) in vec4 _p2vs_location3;
layout(location = 4) in vec4 _p2vs_location4;
smooth out vec2 _vs2fs_location0;
flat out float _vs2fs_location1;
flat out float _vs2fs_location2;
flat out float _vs2fs_location3;
flat out float _vs2fs_location4;
flat out float _vs2fs_location5;
flat out vec4 _vs2fs_location6;

void main() {
    vec2 a_unit = _p2vs_location0;
    vec2 a_p0_ = _p2vs_location1;
    vec2 a_p1_ = _p2vs_location2;
    vec4 a_color = _p2vs_location3;
    vec4 a_widthDash = _p2vs_location4;
    VOut out_ = VOut(vec4(0.0), vec2(0.0), 0.0, 0.0, 0.0, 0.0, 0.0, vec4(0.0));
    vec2 seg = (a_p1_ - a_p0_);
    float segLen = length(seg);
    vec2 tangent = ((segLen > 1e-6) ? (seg / vec2(segLen)) : vec2(1.0, 0.0));
    vec2 normal = vec2(-(tangent.y), tangent.x);
    float halfWidth = (a_widthDash.x * 0.5);
    float ext = (halfWidth + 1.0);
    float along = mix(-(ext), (segLen + ext), a_unit.x);
    float perp = (((a_unit.y - 0.5) * 2.0) * ext);
    vec2 p = ((a_p0_ + (tangent * along)) + (normal * perp));
    mat3x3 _e41 = _group_0_binding_0_vs.proj;
    vec3 clip = (_e41 * vec3(p, 1.0));
    out_.pos = vec4(clip.xy, 0.0, 1.0);
    out_.alongPerp = vec2(along, perp);
    out_.segLen = segLen;
    out_.halfWidth = halfWidth;
    out_.dashStart = a_widthDash.y;
    out_.dashPeriod = a_widthDash.z;
    out_.dashOnLen = a_widthDash.w;
    out_.color = a_color;
    VOut _e61 = out_;
    gl_Position = _e61.pos;
    _vs2fs_location0 = _e61.alongPerp;
    _vs2fs_location1 = _e61.segLen;
    _vs2fs_location2 = _e61.halfWidth;
    _vs2fs_location3 = _e61.dashStart;
    _vs2fs_location4 = _e61.dashPeriod;
    _vs2fs_location5 = _e61.dashOnLen;
    _vs2fs_location6 = _e61.color;
    return;
}

