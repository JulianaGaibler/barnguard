// Distance to an axis-aligned ellipse with radii `radii` centered on the
// origin, exact, from the nearest point on its outline. That point solves a
// quartic, done in closed form as in Inigo Quilez's `sdEllipse`
// (iquilezles.org/articles/ellipsedist). Mirrors `ellipse.ts`, which the
// tests run.
fn ellipseDistance(point: vec2<f32>, radii: vec2<f32>) -> vec3<f32> {
  let quadrantSign = select(vec2<f32>(-1.0), vec2<f32>(1.0), point >= vec2<f32>(0.0));
  // Work in the positive quadrant, with the point nearer the y axis than the
  // x axis, which the closed form assumes.
  let swapped = abs(point.x) > abs(point.y);
  let p = select(abs(point), abs(point).yx, swapped);
  let ab = select(radii, radii.yx, swapped);
  let radiiGap = ab.y * ab.y - ab.x * ab.x;
  var nearest: vec2<f32>;
  if (abs(radiiGap) < 1e-6 * max(ab.x * ab.x, ab.y * ab.y)) {
    // A circle: the nearest point lies straight out from the center.
    let fromCenter = length(p);
    nearest = select(vec2<f32>(0.0, ab.x), p * (ab.x / fromCenter), fromCenter > 1e-6);
  } else {
    let m = ab.x * p.x / radiiGap;
    let m2 = m * m;
    let n = ab.y * p.y / radiiGap;
    let n2 = n * n;
    let c = (m2 + n2 - 1.0) / 3.0;
    let c3 = c * c * c;
    let q = c3 + m2 * n2 * 2.0;
    let discriminant = c3 + m2 * n2;
    let g = m + m * n2;
    var cosine: f32;
    if (discriminant < 0.0) {
      let angle = acos(clamp(q / c3, -1.0, 1.0)) / 3.0;
      let s = cos(angle);
      let t = sin(angle) * sqrt(3.0);
      let rootX = sqrt(max(0.0, -c * (s + t + 2.0) + m2));
      let rootY = sqrt(max(0.0, -c * (s - t + 2.0) + m2));
      cosine = (rootY + sign(radiiGap) * rootX + abs(g) / max(rootX * rootY, 1e-12) - m) / 2.0;
    } else {
      let h = 2.0 * m * n * sqrt(discriminant);
      let s = sign(q + h) * pow(abs(q + h), 1.0 / 3.0);
      let u = sign(q - h) * pow(abs(q - h), 1.0 / 3.0);
      let rootX = -s - u - c * 4.0 + 2.0 * m2;
      let rootY = (s - u) * sqrt(3.0);
      let rootLength = length(vec2<f32>(rootX, rootY));
      cosine = (rootY / sqrt(max(rootLength - rootX, 1e-12)) + 2.0 * g / max(rootLength, 1e-12) - m) / 2.0;
    }
    cosine = clamp(cosine, 0.0, 1.0);
    nearest = ab * vec2<f32>(cosine, sqrt(1.0 - cosine * cosine));
  }
  let offset = p - nearest;
  let gap = length(offset);
  let inside = p.y < nearest.y;
  // Away from the nearest point, flipped toward it when inside, so the
  // gradient always points outward. On the outline, the outline's normal.
  let normal = nearest / (ab * ab);
  let onOutline = normal / max(length(normal), 1e-12);
  var direction = select(onOutline, select(offset, -offset, inside) / max(gap, 1e-12), gap > 1e-6);
  direction = select(direction, direction.yx, swapped);
  return vec3<f32>(select(gap, -gap, inside), quadrantSign * direction);
}
