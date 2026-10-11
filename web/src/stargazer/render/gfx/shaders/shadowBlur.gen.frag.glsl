#version 300 es

precision highp float;
precision highp int;

struct Params {
    vec4 axis;
    vec4 flags;
    vec4 weights[10];
};
struct VOut {
    vec4 pos;
    vec2 uv;
};
layout(std140) uniform Params_block_0Fragment { Params _group_0_binding_1_fs; };

uniform highp sampler2D _group_0_binding_0_fs;

smooth in vec2 _vs2fs_location0;
layout(location = 0) out vec4 _fs2p_location0;

float weightAt(int i_1) {
    float _e9 = _group_0_binding_1_fs.weights[(i_1 / 4)][(i_1 % 4)];
    return _e9;
}

void main() {
    VOut in_ = VOut(gl_FragCoord, _vs2fs_location0);
    float r = 0.0;
    int i = 1;
    vec4 _e3 = _group_0_binding_1_fs.axis;
    vec2 dir = _e3.xy;
    float texelSize = _group_0_binding_1_fs.axis.z;
    float _e12 = _group_0_binding_1_fs.axis.w;
    int tapCount = int(_e12);
    vec2 centerUV = (in_.uv - (dir * (0.5 * texelSize)));
    vec2 stepUV = (dir * texelSize);
    float _e21 = weightAt(0);
    vec4 _e25 = textureLod(_group_0_binding_0_fs, vec2(centerUV), 0.0);
    r = (_e21 * _e25.x);
    bool loop_init = true;
    while(true) {
        if (!loop_init) {
            int _e54 = i;
            i = (_e54 + 1);
        }
        loop_init = false;
        int _e31 = i;
        if ((_e31 < tapCount)) {
        } else {
            break;
        }
        {
            int _e33 = i;
            vec2 off = (stepUV * float(_e33));
            vec4 _e40 = textureLod(_group_0_binding_0_fs, vec2((centerUV + off)), 0.0);
            float a = _e40.x;
            vec4 _e46 = textureLod(_group_0_binding_0_fs, vec2((centerUV - off)), 0.0);
            float b = _e46.x;
            float _e48 = r;
            int _e49 = i;
            float _e50 = weightAt(_e49);
            r = (_e48 + (_e50 * (a + b)));
        }
    }
    vec4 gTex = textureLod(_group_0_binding_0_fs, vec2(centerUV), 0.0);
    float _e66 = _group_0_binding_1_fs.flags.x;
    float g = ((_e66 > 0.5) ? gTex.y : gTex.x);
    float _e70 = r;
    _fs2p_location0 = vec4(_e70, g, 0.0, 1.0);
    return;
}

