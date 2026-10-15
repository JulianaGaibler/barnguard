/**
 * Signed distance to an axis-aligned ellipse centered on the origin, with its
 * gradient, as `[distance, gradientX, gradientY]`. This is the CPU form of the
 * shape program's `ellipseDistance` in `shaders/include/ellipse.inc.wgsl`, kept
 * the same so tests can check the shader's math.
 *
 * The distance is exact. The usual cheap estimate, the implicit function over
 * its gradient, errs by about K / min(rx, ry) units near the outline, with K
 * growing with the ellipse's aspect ratio, so no fixed pixel size makes it safe
 * for edges.
 */

export type DistanceAndGradient = [number, number, number]

/**
 * The exact distance to the ellipse with radii `rx`, `ry`, from the nearest
 * point on its outline. That point solves a quartic, done in closed form as in
 * Inigo Quilez's `sdEllipse` (iquilezles.org/articles/ellipsedist).
 */
export function ellipseDistance(
  px: number,
  py: number,
  rx: number,
  ry: number,
): DistanceAndGradient {
  const signX = px < 0 ? -1 : 1
  const signY = py < 0 ? -1 : 1
  // Work in the positive quadrant, with the point nearer the y axis than the
  // x axis, which the closed form assumes.
  let x = Math.abs(px)
  let y = Math.abs(py)
  let a = rx
  let b = ry
  const swapped = x > y
  if (swapped) {
    ;[x, y] = [y, x]
    ;[a, b] = [b, a]
  }
  let nearestX: number
  let nearestY: number
  const radiiGap = b * b - a * a
  if (Math.abs(radiiGap) < 1e-9 * Math.max(a * a, b * b)) {
    // A circle: the nearest point lies straight out from the center.
    const fromCenter = Math.hypot(x, y)
    const scale = fromCenter > 1e-12 ? a / fromCenter : 0
    nearestX = fromCenter > 1e-12 ? x * scale : 0
    nearestY = fromCenter > 1e-12 ? y * scale : a
  } else {
    const m = (a * x) / radiiGap
    const m2 = m * m
    const n = (b * y) / radiiGap
    const n2 = n * n
    const c = (m2 + n2 - 1) / 3
    const c3 = c * c * c
    const q = c3 + m2 * n2 * 2
    const discriminant = c3 + m2 * n2
    const g = m + m * n2
    let cosine: number
    if (discriminant < 0) {
      const angle = Math.acos(Math.min(1, Math.max(-1, q / c3))) / 3
      const s = Math.cos(angle)
      const t = Math.sin(angle) * Math.sqrt(3)
      const rootX = Math.sqrt(Math.max(0, -c * (s + t + 2) + m2))
      const rootY = Math.sqrt(Math.max(0, -c * (s - t + 2) + m2))
      cosine =
        (rootY +
          Math.sign(radiiGap) * rootX +
          Math.abs(g) / Math.max(rootX * rootY, 1e-12) -
          m) /
        2
    } else {
      const h = 2 * m * n * Math.sqrt(discriminant)
      const s = Math.sign(q + h) * Math.cbrt(Math.abs(q + h))
      const u = Math.sign(q - h) * Math.cbrt(Math.abs(q - h))
      const rootX = -s - u - c * 4 + 2 * m2
      const rootY = (s - u) * Math.sqrt(3)
      const rootLength = Math.hypot(rootX, rootY)
      cosine =
        (rootY / Math.sqrt(Math.max(rootLength - rootX, 1e-12)) +
          (2 * g) / Math.max(rootLength, 1e-12) -
          m) /
        2
    }
    cosine = Math.min(1, Math.max(0, cosine))
    nearestX = a * cosine
    nearestY = b * Math.sqrt(1 - cosine * cosine)
  }
  const offsetX = x - nearestX
  const offsetY = y - nearestY
  const gap = Math.hypot(offsetX, offsetY)
  const inside = y < nearestY
  let gradientX: number
  let gradientY: number
  if (gap > 1e-9) {
    // Away from the nearest point, flipped toward it when inside, so the
    // gradient always points outward.
    gradientX = (inside ? -offsetX : offsetX) / gap
    gradientY = (inside ? -offsetY : offsetY) / gap
  } else {
    const normalX = nearestX / (a * a)
    const normalY = nearestY / (b * b)
    const length = Math.hypot(normalX, normalY) || 1
    gradientX = normalX / length
    gradientY = normalY / length
  }
  if (swapped) [gradientX, gradientY] = [gradientY, gradientX]
  return [inside ? -gap : gap, signX * gradientX, signY * gradientY]
}
