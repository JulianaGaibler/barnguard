// Signed distances and edge coverage shared by the 2D programs. Distance
// functions return (distance, gradient.x, gradient.y).

fn circleDistance(point: vec2<f32>, radius: f32) -> vec3<f32> {
  let fromCenter = length(point);
  let direction = select(vec2<f32>(1.0, 0.0), point / fromCenter, fromCenter > 1e-6);
  return vec3<f32>(fromCenter - radius, direction);
}

// `point` is relative to the box center. `cornerRadii` is (top left,
// top right, bottom right, bottom left).
fn roundBoxDistance(point: vec2<f32>, halfSize: vec2<f32>, cornerRadii: vec4<f32>) -> vec3<f32> {
  let column = select(cornerRadii.xw, cornerRadii.yz, point.x > 0.0);
  let cornerRadius = select(column.x, column.y, point.y > 0.0);
  // Measured against the inner box, the box shrunk by the corner radius, in
  // the point's quadrant folded onto the positive one.
  let fromInnerBox = abs(point) - halfSize + vec2<f32>(cornerRadius);
  let beyondInnerBox = max(fromInnerBox, vec2<f32>(0.0));
  let gapToInnerBox = length(beyondInnerBox);
  let outsideInnerBox = max(fromInnerBox.x, fromInnerBox.y) > 0.0;
  let nearestSide = select(vec2<f32>(0.0, 1.0), vec2<f32>(1.0, 0.0), fromInnerBox.x > fromInnerBox.y);
  let foldedDirection = select(nearestSide, beyondInnerBox / max(gapToInnerBox, 1e-6), outsideInnerBox);
  let distance = select(max(fromInnerBox.x, fromInnerBox.y), gapToInnerBox, outsideInnerBox) - cornerRadius;
  let quadrantSign = select(vec2<f32>(-1.0), vec2<f32>(1.0), point >= vec2<f32>(0.0));
  return vec3<f32>(distance, quadrantSign * foldedDirection);
}

// `fwidth` of a distance, computed exactly from its gradient. `pixelStep.xy`
// and `pixelStep.zw` are the local displacement of one device pixel along x
// and y, so (1, 0, 0, 1) for a shape measured in device pixels.
fn distanceChangePerPixel(gradient: vec2<f32>, pixelStep: vec4<f32>) -> f32 {
  return abs(dot(gradient, pixelStep.xy)) + abs(dot(gradient, pixelStep.zw));
}

// A linear ramp one pixel wide across the edge. Every 2D edge and analytic
// clip uses it, so a `fillCircle` and a `setClip` circle of the same size line
// up exactly.
fn coverage(distance: f32, changePerPixel: f32) -> f32 {
  return clamp(0.5 - distance / max(changePerPixel, 1e-4), 0.0, 1.0);
}
