#version 300 es

precision highp float;
precision highp int;

struct BlurParams {
    vec4 dirRes;
    vec4 control;
};
struct VOut {
    vec4 pos;
    vec2 uv;
};
layout(std140) uniform BlurParams_block_0Fragment { BlurParams _group_0_binding_6_fs; };

uniform highp sampler2D _group_0_binding_0_fs;

uniform highp sampler2D _group_0_binding_1_fs;

smooth in vec2 _vs2fs_location0;
layout(location = 0) out vec4 _fs2p_location0;

float unpack16_(vec2 ba) {
    return ((((ba.x * 255.0) * 256.0) + (ba.y * 255.0)) / 65535.0);
}

float blurAt(vec2 uv) {
    float sum = 0.0;
    float wsum = 1.0;
    int i = 1;
    int sgn = 0;
    vec4 _e3 = _group_0_binding_6_fs.dirRes;
    vec4 _e7 = _group_0_binding_6_fs.dirRes;
    vec2 dirUv = (_e3.xy / _e7.zw);
    float sigma = _group_0_binding_6_fs.control.x;
    vec4 _e18 = textureLod(_group_0_binding_0_fs, vec2(uv), 0.0);
    float cAO = _e18.x;
    vec4 _e23 = textureLod(_group_0_binding_1_fs, vec2(uv), 0.0);
    float _e25 = unpack16_(_e23.zw);
    sum = cAO;
    bool loop_init = true;
    while(true) {
        if (!loop_init) {
            int _e84 = i;
            i = (_e84 + 1);
        }
        loop_init = false;
        int _e31 = i;
        if ((_e31 <= 6)) {
        } else {
            break;
        }
        {
            int _e34 = i;
            int _e35 = i;
            float sw = exp((-(float((_e34 * _e35))) / 18.0));
            sgn = -1;
            bool loop_init_1 = true;
            while(true) {
                if (!loop_init_1) {
                    int _e81 = sgn;
                    sgn = (_e81 + 2);
                }
                loop_init_1 = false;
                int _e43 = sgn;
                if ((_e43 <= 1)) {
                } else {
                    break;
                }
                {
                    int _e46 = i;
                    int _e48 = sgn;
                    vec2 o = (dirUv * (float(_e46) * float(_e48)));
                    vec4 _e56 = textureLod(_group_0_binding_0_fs, vec2((uv + o)), 0.0);
                    float sAO = _e56.x;
                    vec4 _e62 = textureLod(_group_0_binding_1_fs, vec2((uv + o)), 0.0);
                    float _e64 = unpack16_(_e62.zw);
                    float dd = (_e64 - _e25);
                    float dw = exp((-((dd * dd)) / max(1e-6, ((2.0 * sigma) * sigma))));
                    float w = (sw * dw);
                    float _e76 = sum;
                    sum = (_e76 + (sAO * w));
                    float _e79 = wsum;
                    wsum = (_e79 + w);
                }
            }
        }
    }
    float _e87 = sum;
    float _e88 = wsum;
    return (_e87 / _e88);
}

void main() {
    VOut in_ = VOut(gl_FragCoord, _vs2fs_location0);
    float _e2 = blurAt(in_.uv);
    _fs2p_location0 = vec4(_e2, _e2, _e2, 1.0);
    return;
}

