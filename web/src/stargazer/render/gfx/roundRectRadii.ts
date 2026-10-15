/**
 * Corner radii for a rounded rectangle, in the CSS `border-radius` shorthand: a
 * single number for all four corners, or 1 to 4 numbers. With an array the CSS
 * expansion applies: `[all]`, `[tl&br, tr&bl]`, `[tl, tr&bl, br]`, `[tl, tr,
 * br, bl]`.
 */
export type RoundRectRadii = number | readonly number[]

/** Four resolved corner radii, clockwise from the top-left. */
export type ResolvedRadii = readonly [
  topLeft: number,
  topRight: number,
  bottomRight: number,
  bottomLeft: number,
]

function scaleFor(sum: number, len: number): number {
  return sum > 0 ? len / sum : Infinity
}

/**
 * Expand the {@link RoundRectRadii} shorthand into `[tl, tr, br, bl]` as given,
 * without clamping. Writes into `out`.
 */
export function expandRadii(
  radii: RoundRectRadii,
  out: [number, number, number, number],
): [number, number, number, number] {
  let tl: number
  let tr: number
  let br: number
  let bl: number
  if (typeof radii === 'number') {
    tl = tr = br = bl = radii
  } else {
    switch (radii.length) {
      case 0:
        tl = tr = br = bl = 0
        break
      case 1:
        tl = tr = br = bl = radii[0]
        break
      case 2:
        tl = br = radii[0]
        tr = bl = radii[1]
        break
      case 3:
        tl = radii[0]
        tr = bl = radii[1]
        br = radii[2]
        break
      default:
        tl = radii[0]
        tr = radii[1]
        br = radii[2]
        bl = radii[3]
    }
  }
  out[0] = tl
  out[1] = tr
  out[2] = br
  out[3] = bl
  return out
}

/**
 * Expand the {@link RoundRectRadii} shorthand into `[tl, tr, br, bl]`, clamp
 * negatives to zero, and proportionally shrink so no two adjacent corners
 * overrun their shared side, matching how `CanvasRenderingContext2D.roundRect`
 * normalizes radii. Doing this on the CPU keeps the two rendering backends
 * pixel-identical and keeps the fill shader's signed-distance field valid (a
 * radius above the half-extent would otherwise invert the corner).
 *
 * Writes into `out` and returns it when one is given, so a caller drawing every
 * frame allocates nothing. Otherwise returns a new tuple.
 */
export function resolveRadii(
  radii: RoundRectRadii,
  w: number,
  h: number,
  out?: [number, number, number, number],
): ResolvedRadii {
  const expanded = expandRadii(radii, out ?? [0, 0, 0, 0])
  let tl = expanded[0]
  let tr = expanded[1]
  let br = expanded[2]
  let bl = expanded[3]

  if (w <= 0 || h <= 0) return [0, 0, 0, 0]

  tl = Math.max(0, tl)
  tr = Math.max(0, tr)
  br = Math.max(0, br)
  bl = Math.max(0, bl)

  const f = Math.min(
    1,
    scaleFor(tl + tr, w), // top edge
    scaleFor(bl + br, w), // bottom edge
    scaleFor(tl + bl, h), // left edge
    scaleFor(tr + br, h), // right edge
  )
  if (f < 1) {
    tl *= f
    tr *= f
    br *= f
    bl *= f
  }
  if (!out) return [tl, tr, br, bl]
  out[0] = tl
  out[1] = tr
  out[2] = br
  out[3] = bl
  return out
}
