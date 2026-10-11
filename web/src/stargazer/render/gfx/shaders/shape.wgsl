// Shape program. One instanced unit quad covers three shape
// families selected by shapeType (a_shape.x): textured (text + atlas sprites),
// circle SDF, and rounded-box SDF, so text, sprites, and vector shapes share
// one blend-only batch. Each vertex branch positions the quad for its family in
// device px. The fragment branch evaluates the matching SDF or texture sample.
//
// Textured instances pick a fixed-unit texture (atlas or label page) via
// texIndex. GLSL ES 3.00 forbids indexing a sampler array by a non-uniform
// expression, and WGSL forbids `textureSample` under non-uniform control flow,
// so both pages are sampled unconditionally and selected (identical result).
//
// A circle or round-rect fill can also be a linear gradient: a_paint carries
// the device-space axis projection (see `packing.ts`'s `gradientAxis`) and a
// row into the shared ramp atlas, encoded `rampRow + 1` so a zeroed (no
// gradient) record reads as 0. The fill's opacity then rides in
// a_colorFill's alpha channel instead of a separate field, since rgb goes
// unused once the ramp supplies the color. The stroke has no paint slot.
//
// Bindings match batchLayout.ts: attributes at LOC_SHAPE_* (0..10), Frame at
// FRAME_UBO_BINDING (0), u_texAtlas at unit 0, u_texLabel at unit 1, u_ramp
// (the shared ramp atlas) at unit 2, ShapeParams (the debug-mode override) at
// SHAPE_PARAMS_UBO_BINDING (9).

struct Frame {
  proj: mat3x3<f32>,
  targetH: f32,
  fragYFlip: f32,
};
@group(0) @binding(0) var<uniform> frame: Frame;

struct Clip {
  kind: f32,
  cx: f32,
  cy: f32,
  r: f32,
  halfW: f32,
  halfH: f32,
  rrRadius: f32,
  clipPad: f32,
};
@group(0) @binding(8) var<uniform> clipShape: Clip;

// Analytic clip coverage in device px. frame.fragYFlip corrects WebGL2's
// bottom-up gl_FragCoord. Multiply the premultiplied fragment output by this.
fn clipRoundBox(p: vec2<f32>, b: vec2<f32>, rad: f32) -> f32 {
  let q = abs(p) - b + vec2<f32>(rad);
  return min(max(q.x, q.y), 0.0) + length(max(q, vec2<f32>(0.0))) - rad;
}
fn devicePos(fragPos: vec2<f32>) -> vec2<f32> {
  let fy = select(fragPos.y, frame.targetH - fragPos.y, frame.fragYFlip > 0.5);
  return vec2<f32>(fragPos.x, fy);
}
fn clipCoverage(fragPos: vec2<f32>) -> f32 {
  if (clipShape.kind < 0.5) { return 1.0; }
  let p = devicePos(fragPos) - vec2<f32>(clipShape.cx, clipShape.cy);
  var d: f32;
  if (clipShape.kind < 1.5) {
    d = length(p) - clipShape.r;
  } else {
    d = clipRoundBox(p, vec2<f32>(clipShape.halfW, clipShape.halfH), clipShape.rrRadius);
  }
  return clamp(0.5 - d / max(fwidth(d), 1e-4), 0.0, 1.0);
}

@group(1) @binding(0) var u_texAtlas: texture_2d<f32>;
@group(1) @binding(16) var u_texAtlasSamp: sampler;
@group(1) @binding(1) var u_texLabel: texture_2d<f32>;
@group(1) @binding(17) var u_texLabelSamp: sampler;
@group(1) @binding(2) var u_ramp: texture_2d<f32>;
@group(1) @binding(18) var u_rampSamp: sampler;

// Per-run debug-mode override, the HUD's 'overdraw'/'batch-color' modes.
// flags.x: 0 normal, 1 overdraw, 2 batch-color.
struct ShapeParams {
  debugColor: vec4<f32>,
  flags: vec4<u32>,
};
@group(1) @binding(9) var<uniform> params: ShapeParams;

// `max_inter_stage_shader_variables` is 16 locations on WebGPU (0..15). Every
// shape kind's own data packs into a handful of generically-named vec4
// slots instead of one named varying per field, reused differently per
// kind (exactly how the instance record's own words already are). Each
// kind's packing is documented at its `vs_main` branch and unpacked the
// same way in `fs_main`.
struct VOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) @interpolate(flat) shapeType: i32,
  // Smooth (per-fragment interpolated): textured -> uv, circle -> worldPos
  // (device px), round-rect/shadow -> local (centered local coords).
  @location(1) varyingPos: vec2<f32>,
  // Flat: textured -> tint, circle/round-rect/shadow -> fill color.
  @location(2) @interpolate(flat) colorFill: vec4<f32>,
  // Flat: circle/round-rect -> stroke color. Unused otherwise.
  @location(3) @interpolate(flat) colorStroke: vec4<f32>,
  // Flat: circle/round-rect -> fill gradient, see the file header. Unused otherwise.
  @location(4) @interpolate(flat) paint: vec4<f32>,
  // Flat, kind-specific: textured (texIndex, 0, 0, 0); circle (center.x,
  // center.y, radius, strokeWidth); round-rect (halfExt.x, halfExt.y,
  // strokeWidth, strokeOffset); shadow (halfExt.x, halfExt.y, sigma, inset).
  @location(5) @interpolate(flat) paramsA: vec4<f32>,
  // Flat: round-rect/shadow -> corner radii (tl, tr, br, bl). Unused otherwise.
  @location(6) @interpolate(flat) radii: vec4<f32>,
  // Flat, kind-specific: circle (dashStart, dashPeriod, _, _); shadow
  // (offsetX, offsetY, spread, _). Unused otherwise.
  @location(7) @interpolate(flat) paramsB: vec4<f32>,
};

@vertex
fn vs_main(
  @location(0) a_unit: vec2<f32>,
  @location(1) a_mCol0: vec2<f32>,
  @location(2) a_mCol1: vec2<f32>,
  @location(3) a_mTranslate: vec2<f32>,
  @location(4) a_shape: vec4<f32>,       // (shapeType, feather, texIndex, pad/shadowInset)
  @location(5) a_params: vec4<f32>,      // circle (radius, stroke, dashStart, dashPeriod) / rrect+shadow (halfW, halfH, stroke, strokeOffset)
  @location(6) a_radii: vec4<f32>,       // round-rect / shadow corner radii (tl, tr, br, bl)
  @location(7) a_srcRect: vec4<f32>,     // textured (u0, v0, u1, v1) / shadow (sigma, spread, offsetX, offsetY)
  @location(8) a_colorFill: vec4<f32>,   // premultiplied RGBA
  @location(9) a_colorStroke: vec4<f32>, // premultiplied RGBA
  @location(10) a_paint: vec4<f32>,      // fill gradient: see the file header
) -> VOut {
  var out: VOut;
  let shape = i32(a_shape.x + 0.5);
  out.shapeType = shape;
  out.colorStroke = a_colorStroke;
  out.paint = a_paint;

  var p: vec2<f32>;
  if (shape == 1) {
    // Circle: center + (unit-0.5)*2*outerRadius.
    let center = a_mTranslate;
    let radius = a_params.x;
    let strokeWidth = a_params.y;
    let outerRadius = radius + strokeWidth * 0.5 + 1.0;
    p = center + (a_unit - vec2<f32>(0.5)) * 2.0 * outerRadius;
    out.varyingPos = p;
    out.colorFill = a_colorFill;
    out.paramsA = vec4<f32>(center, radius, strokeWidth);
    out.paramsB = vec4<f32>(a_params.zw, 0.0, 0.0);
  } else if (shape == 2) {
    // Round-rect: local centered space + affine. The quad must reach as far
    // as the fragment stage samples: the stroke coverage ramp reads up to
    // strokeOffset +/- strokeWidth * 0.5 outside the box, not just the AA
    // feather, or a wide or outside-aligned stroke's outer half falls
    // outside the quad and is clipped.
    let halfExt = a_params.xy;
    let feather = a_shape.y;
    let strokeWidth = a_params.z;
    let strokeOffset = a_params.w;
    let inflate = feather + abs(strokeOffset) + strokeWidth * 0.5;
    let local = (a_unit - vec2<f32>(0.5)) * 2.0 * (halfExt + inflate);
    p = a_mTranslate + a_mCol0 * local.x + a_mCol1 * local.y;
    out.varyingPos = local;
    out.colorFill = a_colorFill;
    out.paramsA = vec4<f32>(halfExt, strokeWidth, strokeOffset);
    out.radii = a_radii;
  } else if (shape == 3) {
    // Drop shadow: local centered space + affine, same walk as round-rect
    // (a circle's shadow is a round-rect shadow with uniform radii). The
    // quad covers both the true border box (for the outset knockout / inset
    // guard) and the blurred, offset, spread shadow box.
    let halfExt = a_params.xy;
    let strokeOffset = a_params.w;
    let sigma = max(a_srcRect.x, 0.0);
    let spread = a_srcRect.y;
    let offset = a_srcRect.zw;
    let trueHalfExt = halfExt + strokeOffset;
    let shadowHalfExt = max(trueHalfExt + spread, vec2<f32>(0.0));
    let pad = 3.0 * sigma;
    let quadHalfExt = max(trueHalfExt, shadowHalfExt + length(offset)) + pad;
    let local = (a_unit - vec2<f32>(0.5)) * 2.0 * quadHalfExt;
    p = a_mTranslate + a_mCol0 * local.x + a_mCol1 * local.y;
    out.varyingPos = local;
    out.colorFill = a_colorFill;
    out.paramsA = vec4<f32>(trueHalfExt, sigma, a_shape.w);
    out.radii = a_radii;
    out.paramsB = vec4<f32>(offset, spread, 0.0);
  } else {
    // Textured: affine quad, sample srcRect × tint.
    p = a_mCol0 * a_unit.x + a_mCol1 * a_unit.y + a_mTranslate;
    out.varyingPos = mix(a_srcRect.xy, a_srcRect.zw, a_unit);
    out.colorFill = a_colorFill;
    out.paramsA = vec4<f32>(a_shape.z, 0.0, 0.0, 0.0);
  }

  let clip = frame.proj * vec3<f32>(p, 1.0);
  out.pos = vec4<f32>(clip.xy, 0.0, 1.0);
  return out;
}

// Signed distance to a rounded box. `r` = (tl, tr, br, bl) corner radii.
fn sdRoundBox(p: vec2<f32>, b: vec2<f32>, r: vec4<f32>) -> f32 {
  let rr = select(r.xw, r.yz, p.x > 0.0);
  let radius = select(rr.x, rr.y, p.y > 0.0);
  let q = abs(p) - b + vec2<f32>(radius);
  return min(max(q.x, q.y), 0.0) + length(max(q, vec2<f32>(0.0))) - radius;
}

// Analytic AA coverage from a signed distance via its screen-space gradient.
//
// The one edge idiom for 2D: round-rects, circles and the analytic clip in
// `clipCoverage` all ramp through it. Drawing a disc with `fillCircle` and then
// clipping content to the same circle with `setClip` is ordinary, and a cubic
// `smoothstep` against this linear ramp would leave the two edges a fraction of
// a pixel apart. Linear is also the correct box-filter coverage for a straight
// edge.
fn coverage(d: f32) -> f32 {
  return clamp(0.5 - d / max(fwidth(d), 1e-4), 0.0, 1.0);
}

// Evan Wallace's analytic rounded-box shadow
// (madebyevan.com/shaders/fast-rounded-rectangle-shadows). A closed-form
// approximation of the error function, accurate to about 1.2e-7, used to
// integrate a Gaussian analytically along x.
fn shadowErf(x: f32) -> f32 {
  let s = sign(x);
  let a = abs(x);
  var y = 1.0 + (0.278393 + (0.230389 + (0.000972 + 0.078108 * a) * a) * a) * a;
  y = y * y;
  return s - s / (y * y);
}

fn shadowGaussian(x: f32, sigma: f32) -> f32 {
  return exp(-(x * x) / (2.0 * sigma * sigma)) / (sqrt(2.0 * 3.14159265359) * sigma);
}

// The 1D shadow profile along x at row `y`, for a box of half-size
// `halfExt` whose corner radius on this row's left/right edge is
// `cornerL`/`cornerR` (picked per quadrant by the caller, the same way
// `sdRoundBox` does). `curved` is how far the flat part of the edge is
// pulled in to make room for that corner's arc.
fn shadowBoxX(x: f32, y: f32, sigma: f32, cornerL: f32, cornerR: f32, halfExt: vec2<f32>) -> f32 {
  let deltaL = min(halfExt.y - cornerL - abs(y), 0.0);
  let curvedL = halfExt.x - cornerL + sqrt(max(0.0, cornerL * cornerL - deltaL * deltaL));
  let deltaR = min(halfExt.y - cornerR - abs(y), 0.0);
  let curvedR = halfExt.x - cornerR + sqrt(max(0.0, cornerR * cornerR - deltaR * deltaR));
  let invSigma = 0.70710678118 / sigma; // sqrt(0.5) / sigma
  let intHi = 0.5 + 0.5 * shadowErf((x + curvedL) * invSigma);
  let intLo = 0.5 + 0.5 * shadowErf((x - curvedR) * invSigma);
  return intHi - intLo;
}

/**
 * Shadow coverage (0..1) at local point `p`, relative to a box of half
 * extents `halfExt` and per-corner radii `radii` (tl, tr, br, bl), blurred
 * by Gaussian sigma. Integrates along y in four samples, clamped to the
 * box's own y-extent so a shape thinner than the kernel still samples
 * inside it (a fixed sample count over a fixed +/-3 sigma range would
 * otherwise miss the shape entirely and band).
 */
fn shadowCoverage(p: vec2<f32>, halfExt: vec2<f32>, radii: vec4<f32>, sigma: f32) -> f32 {
  if (sigma < 1e-4) {
    return coverage(sdRoundBox(p, halfExt, radii));
  }
  let low = p.y - halfExt.y;
  let high = p.y + halfExt.y;
  let start = clamp(-3.0 * sigma, low, high);
  let end = clamp(3.0 * sigma, low, high);
  let step = (end - start) / 4.0;
  var y = start + step * 0.5;
  var value = 0.0;
  for (var i = 0; i < 4; i = i + 1) {
    let rowY = p.y - y;
    // sdRoundBox's own quadrant pick: left column is (tl, bl), right is (tr, br).
    let cornerL = select(radii.x, radii.w, rowY > 0.0);
    let cornerR = select(radii.y, radii.z, rowY > 0.0);
    value = value + shadowBoxX(p.x, rowY, sigma, cornerL, cornerR, halfExt) * shadowGaussian(y, sigma) * step;
    y = y + step;
  }
  return value;
}

@fragment
fn fs_main(in: VOut) -> @location(0) vec4<f32> {
  // Texture samples and SDF derivatives (fwidth) must run in uniform control
  // flow, but shapeType is a per-instance varying so the branches below are not
  // uniform. Evaluate all of them up front and let the branches select.
  // `varyingPos` doubles as the UV for textured instances only; the other
  // kinds never sample these two, so what it holds for them is irrelevant.
  let atlasTexel = textureSample(u_texAtlas, u_texAtlasSamp, in.varyingPos);
  let labelTexel = textureSample(u_texLabel, u_texLabelSamp, in.varyingPos);
  // Gradient fill, sampled unconditionally alongside the two texture pages
  // above for the same reason: there is no per-run uniform here yet to
  // branch on (that lands with the analytic-shadow per-run block), so every
  // shape fragment pays one more fetch regardless of shapeType or whether
  // this instance carries a gradient.
  let hasGradient = in.paint.w > 0.5;
  let gradT = clamp(dot(devicePos(in.pos.xy), in.paint.xy) - in.paint.z, 0.0, 1.0);
  // See gradientRadial.wgsl: remap onto texel centers, and ATLAS_ROWS must
  // match TextureManager.ts.
  let gradU = gradT * (255.0 / 256.0) + 0.5 / 256.0;
  let gradV = (in.paint.w - 1.0 + 0.5) / 64.0;
  let rampTexel = textureSample(u_ramp, u_rampSamp, vec2<f32>(gradU, gradV));
  let fillColor = select(in.colorFill, rampTexel * in.colorFill.a, hasGradient);
  let halfExt = in.paramsA.xy;
  let rrDist = sdRoundBox(in.varyingPos, halfExt, in.radii);
  let rrFillCoverage = coverage(rrDist);
  let strokeWidth = in.paramsA.z;
  let strokeOffset = in.paramsA.w;
  let rrStrokeCoverage = coverage(abs(rrDist - strokeOffset) - strokeWidth * 0.5);
  let center = in.paramsA.xy;
  let radius = in.paramsA.z;
  let circDelta = in.varyingPos - center;
  let circDist = length(circDelta) - radius;
  let circFillCoverage = coverage(circDist);
  let circStrokeCoverage = coverage(abs(circDist) - in.paramsA.w * 0.5);

  var outColor: vec4<f32>;
  if (in.shapeType == 1) {
    // Circle SDF (distance + coverage precomputed above). paramsA = (center,
    // radius, strokeWidth), paramsB = (dashStart, dashPeriod, _, _).
    let circStrokeWidth = in.paramsA.w;
    let fill = fillColor * circFillCoverage;
    var stroke = vec4<f32>(0.0);
    if (circStrokeWidth > 0.0) {
      var strokeAlpha = circStrokeCoverage;
      let dashPeriod = in.paramsB.y;
      if (dashPeriod > 0.0 && strokeAlpha > 0.0) {
        let dashStart = in.paramsB.x;
        let dashOnLen = dashPeriod * 0.5;
        let angle = atan2(circDelta.y, circDelta.x);
        let TWO_PI = 6.28318530718;
        let wrap = select(angle, angle + TWO_PI, angle < 0.0);
        let arcPos = wrap * radius;
        let s = dashStart + arcPos;
        let phase = s - dashPeriod * floor(s / dashPeriod);
        let off = smoothstep(dashOnLen - 0.5, dashOnLen + 0.5, phase);
        strokeAlpha = strokeAlpha * (1.0 - off);
      }
      stroke = in.colorStroke * strokeAlpha;
    }
    outColor = stroke + fill * (1.0 - stroke.a);
    if (outColor.a <= 0.0) {
      discard;
    }
  } else if (in.shapeType == 2) {
    // Round-rect SDF (distance + coverage precomputed above). paramsA =
    // (halfExt, strokeWidth, strokeOffset).
    let fill = fillColor * rrFillCoverage;
    var stroke = vec4<f32>(0.0);
    if (strokeWidth > 0.0) {
      stroke = in.colorStroke * rrStrokeCoverage;
    }
    outColor = stroke + fill * (1.0 - stroke.a);
    if (outColor.a <= 0.0) {
      discard;
    }
  } else if (in.shapeType == 3) {
    // Drop shadow. paramsA = (true halfExt, sigma, inset), paramsB =
    // (offsetX, offsetY, spread, _). `in.colorFill` carries the shadow's
    // own tint (the record has no separate stroke). Spread grows the
    // shadow's own box only on corners that already had a radius: a spread
    // square corner stays square, matching `box-shadow`.
    let trueHalfExt = in.paramsA.xy;
    let sigma = in.paramsA.z;
    let inset = in.paramsA.w;
    let offset = in.paramsB.xy;
    let spread = in.paramsB.z;
    let hasRadius = step(vec4<f32>(1e-6), in.radii);
    let shadowRadii = hasRadius * max(in.radii + vec4<f32>(spread), vec4<f32>(0.0));
    let shadowHalfExt = max(trueHalfExt + spread, vec2<f32>(0.0));
    let shadowLocal = in.varyingPos - offset;
    let shadowCov = shadowCoverage(shadowLocal, shadowHalfExt, shadowRadii, sigma);
    let trueCoverage = coverage(sdRoundBox(in.varyingPos, trueHalfExt, in.radii));
    // Outset: knocked out of the border box (CSS: "not painted inside the
    // border-box"). Inset: only inside it.
    let mask = select(1.0 - trueCoverage, trueCoverage, inset > 0.5);
    outColor = in.colorFill * (shadowCov * mask);
    if (outColor.a <= 0.0) {
      discard;
    }
  } else {
    // Textured: both pages sampled above, selected here by texIndex (in
    // paramsA.x) × tint (in colorFill).
    let texel = select(labelTexel, atlasTexel, in.paramsA.x < 0.5);
    outColor = texel * in.colorFill;
  }
  outColor *= clipCoverage(in.pos.xy);
  if (params.flags.x == 1u) {
    // Dim premultiplied red. `lighter` blend (forced per-run, see
    // `ShapeProgram.drawRun`) accumulates it into a heatmap.
    outColor = vec4<f32>(0.05, 0.0, 0.0, 0.05);
  } else if (params.flags.x == 2u) {
    outColor = params.debugColor;
  }
  return outColor;
}
