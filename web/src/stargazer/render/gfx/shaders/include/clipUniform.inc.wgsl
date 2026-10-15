// #include "sdf.inc.wgsl"

// The run's clip in device pixels, staged by `GpuBatchContext` (see
// batchLayout.ts). Exact only under an axis-aligned transform. Needs the
// including shader's `frame` uniform.
struct Clip {
  kind: f32,
  cx: f32,
  cy: f32,
  r: f32,
  halfW: f32,
  halfH: f32,
  pad0: f32,
  pad1: f32,
  // Rounded box corner radii: top left, top right, bottom right, bottom left.
  radii: vec4<f32>,
};
@group(0) @binding(8) var<uniform> clipShape: Clip;

// Kind 0 is no clip, 1 a circle, 2 a rounded box.
fn clipCoverage(fragPos: vec2<f32>) -> f32 {
  if (clipShape.kind < 0.5) {
    return 1.0;
  }
  // WebGL2's `gl_FragCoord.y` counts up from the bottom.
  let deviceY = select(fragPos.y, frame.targetH - fragPos.y, frame.fragYFlip > 0.5);
  let point = vec2<f32>(fragPos.x, deviceY) - vec2<f32>(clipShape.cx, clipShape.cy);
  var distanceAndGradient: vec3<f32>;
  if (clipShape.kind < 1.5) {
    distanceAndGradient = circleDistance(point, clipShape.r);
  } else {
    distanceAndGradient = roundBoxDistance(
      point,
      vec2<f32>(clipShape.halfW, clipShape.halfH),
      clipShape.radii,
    );
  }
  let changePerPixel = distanceChangePerPixel(distanceAndGradient.yz, vec4<f32>(1.0, 0.0, 0.0, 1.0));
  return coverage(distanceAndGradient.x, changePerPixel);
}
