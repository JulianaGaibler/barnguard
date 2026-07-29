#version 300 es

precision highp float;
precision highp int;

struct Frame {
    mat3x3 proj;
};
struct DrawParams {
    vec4 debugColor;
    float clipEnabled;
    float debugMode;
    vec2 pad;
};
struct VOut {
    vec4 pos;
    vec4 color;
    vec2 uv;
};
layout(std140) uniform DrawParams_block_0Fragment { DrawParams _group_1_binding_2_fs; };

uniform highp sampler2D _group_1_binding_1_fs;

smooth in vec4 _vs2fs_location0;
smooth in vec2 _vs2fs_location1;
layout(location = 0) out vec4 _fs2p_location0;

void main() {
    VOut in_ = VOut(gl_FragCoord, _vs2fs_location0, _vs2fs_location1);
    vec4 c = vec4(0.0);
    c = in_.color;
    float _e5 = _group_1_binding_2_fs.clipEnabled;
    if ((_e5 > 0.5)) {
        vec4 _e8 = c;
        vec4 _e12 = texture(_group_1_binding_1_fs, vec2(in_.uv));
        c = (_e8 * _e12.w);
    }
    float _e17 = _group_1_binding_2_fs.debugMode;
    int mode = int((_e17 + 0.5));
    if ((mode == 1)) {
        c = vec4(0.05, 0.0, 0.0, 0.05);
    } else {
        if ((mode == 2)) {
            vec4 _e32 = _group_1_binding_2_fs.debugColor;
            c = _e32;
        }
    }
    vec4 _e33 = c;
    _fs2p_location0 = _e33;
    return;
}

