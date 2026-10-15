import type { GfxGradientStop, GfxLinearGradient } from './Gfx2D'

/**
 * The {@link GfxLinearGradient} that CSS `linear-gradient(<angle>, ...stops)`
 * paints across a `width` × `height` box with its top left corner at the
 * origin. As in CSS, `0` runs bottom to top and `90` runs left to right, and
 * the gradient line is long enough that the first and last stops land on the
 * box's opposite corners. Stop offsets are the CSS positions as fractions, so
 * `0.5` is `50%`, and may lie outside `[0, 1]`.
 *
 * @remarks
 *   A gradient's own stops must lie in `[0, 1]`, so stops outside that range
 *   stretch the axis past the box to reach them and the offsets are rescaled
 *   onto it. The colors inside the box come out the same.
 * @example
 *   // linear-gradient(135deg, #ff6600 0%, #fb2872 100%)
 *   const fill = cssLinearGradient(320, 200, 135, [
 *     { offset: 0, color: '#ff6600' },
 *     { offset: 1, color: '#fb2872' },
 *   ])
 *   scene.root.add(
 *     new ShapeNode({
 *       geometry: { kind: 'rect', width: 320, height: 200, centered: false },
 *       fill,
 *     }),
 *   )
 */
export function cssLinearGradient(
  width: number,
  height: number,
  angleDeg: number,
  stops: readonly GfxGradientStop[],
): GfxLinearGradient {
  const angle = (angleDeg * Math.PI) / 180
  const dx = Math.sin(angle)
  const dy = -Math.cos(angle)
  // The CSS gradient line passes through the center and spans the box's
  // projection onto the direction, corner to corner.
  const length = Math.abs(width * dx) + Math.abs(height * dy)
  const startX = width / 2 - (length / 2) * dx
  const startY = height / 2 - (length / 2) * dy

  let min = 0
  let max = 1
  for (const stop of stops) {
    if (stop.offset < min) min = stop.offset
    if (stop.offset > max) max = stop.offset
  }
  const range = max - min
  return {
    kind: 'linear',
    x0: startX + min * length * dx,
    y0: startY + min * length * dy,
    x1: startX + max * length * dx,
    y1: startY + max * length * dy,
    stops: stops.map((stop) => ({
      offset: (stop.offset - min) / range,
      color: stop.color,
    })),
  }
}
