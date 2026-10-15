/** An axis-aligned box in device pixels. */
export interface DeviceBox {
  x: number
  y: number
  width: number
  height: number
}

/** The matrix parts `deviceBoundsOfRect` reads, in the layout of `Affine2x3`. */
interface Matrix {
  a: number
  b: number
  c: number
  d: number
  e: number
  f: number
}

/**
 * The device-pixel box that bounds `rect` after it is carried through `world`
 * and then `render`, with all four corners mapped so a rotated layer is
 * handled. `out` is filled and returned.
 */
export function deviceBoundsOfRect(
  rect: { x: number; y: number; width: number; height: number },
  world: Matrix,
  render: Matrix,
  out: DeviceBox,
): DeviceBox {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (let i = 0; i < 4; i++) {
    const lx = rect.x + (i === 1 || i === 2 ? rect.width : 0)
    const ly = rect.y + (i >= 2 ? rect.height : 0)
    const wx = world.a * lx + world.c * ly + world.e
    const wy = world.b * lx + world.d * ly + world.f
    const dx = render.a * wx + render.c * wy + render.e
    const dy = render.b * wx + render.d * wy + render.f
    if (dx < minX) minX = dx
    if (dx > maxX) maxX = dx
    if (dy < minY) minY = dy
    if (dy > maxY) maxY = dy
  }
  out.x = minX
  out.y = minY
  out.width = maxX - minX
  out.height = maxY - minY
  return out
}

/** `box` grown by `pad` pixels on every side, in place. */
export function padBox(box: DeviceBox, pad: number): DeviceBox {
  if (pad <= 0) return box
  box.x -= pad
  box.y -= pad
  box.width += pad * 2
  box.height += pad * 2
  return box
}
