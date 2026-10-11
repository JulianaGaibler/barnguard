// Shadow-mask blur pass, run twice (horizontal then vertical) by
// `PathShadowCache`. Each run folds a separable Gaussian blur together with a
// 2x downsample on its own axis: pass one reads the 2x raster and halves
// width, pass two reads pass one's output and halves height, landing on the
// mask's final size with no separate resolve step.
//
// The non-blurred silhouette channel (G) needs no blur, only the downsample,
// which a single bilinear fetch exactly at the midpoint between the two
// source texels being merged already gives (`flags.x` selects which channel
// of the input carries it: pass one's input is single-channel, so G and R
// start from the same source; pass two's input already carries a real G).
//
// Standalone pipeline, no shared Frame UBO.
//
// Bindings: u_src at unit 0 (sampler +16), Params at group 0 binding 1,
// a_pos at location 0 (fullscreen triangle, already in clip space).

// Tap weights pack four `f32` per `vec4`: a uniform-buffer array's element
// stride is fixed at 16 B regardless of element type, so a plain
// `array<f32, N>` would waste 12 of every 16 B. `weightAt` undoes the
// packing with one dynamic vector-component index, itself ordinary WGSL.
const MAX_TAP_VECS = 10; // 10 × 4 = 40 weights

struct Params {
  // (dirX, dirY, srcTexelSizeOnAxis, tapCount). `dir` is a unit step along
  // the blur axis in the INPUT's own uv space, `srcTexelSizeOnAxis` is
  // 1 / inputSizeOnAxis, `tapCount` is taps beyond the center (<= 4 *
  // MAX_TAP_VECS).
  axis: vec4<f32>,
  // x = 1 when the input carries a real G channel (pass two), 0 when R and G
  // read the same single input channel (pass one).
  flags: vec4<f32>,
  // Gaussian weight per tap distance, index 0 is the center tap (used once),
  // index i > 0 is shared by the +i and -i samples (the kernel is symmetric).
  weights: array<vec4<f32>, MAX_TAP_VECS>,
};
@group(0) @binding(1) var<uniform> params: Params;
@group(0) @binding(0) var u_src: texture_2d<f32>;
@group(0) @binding(16) var u_srcSamp: sampler;

fn weightAt(i: i32) -> f32 {
  return params.weights[i / 4][i % 4];
}

struct VOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

@vertex
fn vs_main(@location(0) a_pos: vec2<f32>) -> VOut {
  var out: VOut;
  out.uv = a_pos * 0.5 + vec2<f32>(0.5);
  out.pos = vec4<f32>(a_pos, 0.0, 1.0);
  return out;
}

@fragment
fn fs_main(in: VOut) -> @location(0) vec4<f32> {
  let dir = params.axis.xy;
  let texelSize = params.axis.z;
  let tapCount = i32(params.axis.w);
  // This pass halves resolution on `dir`'s axis, so the output pixel's own
  // uv lands half an INPUT texel past the true midpoint between the two
  // source texels it merges. Shift back onto that midpoint once, up front.
  let centerUV = in.uv - dir * (0.5 * texelSize);
  let stepUV = dir * texelSize;

  var r = weightAt(0) * textureSampleLevel(u_src, u_srcSamp, centerUV, 0.0).r;
  for (var i = 1; i < tapCount; i = i + 1) {
    let off = stepUV * f32(i);
    let a = textureSampleLevel(u_src, u_srcSamp, centerUV + off, 0.0).r;
    let b = textureSampleLevel(u_src, u_srcSamp, centerUV - off, 0.0).r;
    r += weightAt(i) * (a + b);
  }

  let gTex = textureSampleLevel(u_src, u_srcSamp, centerUV, 0.0);
  let g = select(gTex.r, gTex.g, params.flags.x > 0.5);
  return vec4<f32>(r, g, 0.0, 1.0);
}
