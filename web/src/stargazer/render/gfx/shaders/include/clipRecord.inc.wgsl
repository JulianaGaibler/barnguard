// #include "sdf.inc.wgsl"

// Clip coverage from a param table record (see ParamTable.ts), measured in the
// clip's local space so it holds under rotation and uneven scale. `shape` is
// (kind, centerX, centerY, radius) with kind 0 none, 1 circle, 2 rounded box.
// `box` is (halfWidth, halfHeight, top left radius, top right radius).
// `deviceToLocal` holds the affine's two columns, and `deviceToLocalOffset` its
// translation then the bottom right and bottom left radii.
fn clipCoverageRec(
  devicePixel: vec2<f32>,
  shape: vec4<f32>,
  box: vec4<f32>,
  deviceToLocal: vec4<f32>,
  deviceToLocalOffset: vec4<f32>,
) -> f32 {
  if (shape.x < 0.5) {
    return 1.0;
  }
  let local = vec2<f32>(
    deviceToLocal.x * devicePixel.x + deviceToLocal.z * devicePixel.y + deviceToLocalOffset.x,
    deviceToLocal.y * devicePixel.x + deviceToLocal.w * devicePixel.y + deviceToLocalOffset.y,
  );
  let point = local - shape.yz;
  var distanceAndGradient: vec3<f32>;
  if (shape.x < 1.5) {
    distanceAndGradient = circleDistance(point, shape.w);
  } else {
    let cornerRadii = vec4<f32>(box.zw, deviceToLocalOffset.zw);
    distanceAndGradient = roundBoxDistance(point, box.xy, cornerRadii);
  }
  // The affine's columns are the local displacement of one device pixel.
  let changePerPixel = distanceChangePerPixel(distanceAndGradient.yz, deviceToLocal);
  return coverage(distanceAndGradient.x, changePerPixel);
}
