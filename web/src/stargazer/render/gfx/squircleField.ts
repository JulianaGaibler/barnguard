/**
 * The precomputed distance field the shape program reads for smooth corners.
 *
 * A smoothed corner has no cheap closed-form distance, because its outline
 * includes cubic Béziers. But measured in units of its radius, a corner's shape
 * depends only on its smoothing. So the field samples that one family once: a
 * tile per smoothing step, each holding the signed distance and its gradient
 * around a corner of radius 1. The shader scales a sample by the corner's
 * radius and blends the two tiles around its smoothing.
 *
 * A tile covers the corner in its own coordinates: how far a point lies inside
 * the two sides that meet at the corner, `inset.x` from the vertical side and
 * `inset.y` from the horizontal one, over `[PATCH_MIN, PATCH_MAX]` on both
 * axes. The corner's curve starts at most `1 + smoothing` from the corner
 * point, so a patch reaching 2 holds all of it, and the band down to -1 covers
 * strokes and shadows drawn outside the edge. Each texel stores `(distance,
 * gradient.x, gradient.y, 0)`, with the gradient also in inset coordinates.
 *
 * The tiles are built by `npm run gen:squircle` into `squircleField.bin`, half
 * floats in the layout {@link GfxDevice.updateTexture2DData} takes for
 * `'rgba16f'`, tiles stacked from smoothing 0 at the top.
 */
import { squircleCorner, squircleCornerCurves } from './squircle'

/** Texels along each side of one tile. */
export const FIELD_TILE_SIZE = 64
/** Tiles, one per smoothing step from 0 to 1. */
export const FIELD_TILE_COUNT = 21
/** Inset range a tile covers, in units of the corner radius. */
export const FIELD_PATCH_MIN = -1
export const FIELD_PATCH_MAX = 2
/** Texture width and height. */
export const FIELD_WIDTH = FIELD_TILE_SIZE
export const FIELD_HEIGHT = FIELD_TILE_SIZE * FIELD_TILE_COUNT

/** Points per cubic segment when flattening the corner for measuring. */
const CURVE_STEPS = 256
/** How far the straight sides run past the patch, so they bound every texel. */
const SIDE_REACH = 4

/**
 * The corner of radius 1 and the given smoothing as a polyline in inset
 * coordinates, running from the horizontal side through the curve to the
 * vertical side.
 */
export function cornerOutline(smoothing: number): number[] {
  // A budget of 2 always fits, since the curve uses at most 1 + smoothing.
  const corner = squircleCorner(1, smoothing, 2)
  // The curves are relative to the top right corner point with y down, so a
  // point (x, y) there lies (-x, y) inside the two sides.
  const points = [SIDE_REACH, 0, corner.extent, 0]
  let x = -corner.extent
  let y = 0
  for (const [c1x, c1y, c2x, c2y, ex, ey] of squircleCornerCurves(corner)) {
    for (let i = 1; i <= CURVE_STEPS; i++) {
      const t = i / CURVE_STEPS
      const u = 1 - t
      const px =
        u * u * u * x +
        3 * u * u * t * c1x +
        3 * u * t * t * c2x +
        t * t * t * ex
      const py =
        u * u * u * y +
        3 * u * u * t * c1y +
        3 * u * t * t * c2y +
        t * t * t * ey
      points.push(-px, py)
    }
    x = ex
    y = ey
  }
  points.push(0, corner.extent, 0, SIDE_REACH)
  return points
}

/**
 * Whether `(px, py)` is inside the corner: inside the polygon the outline makes
 * when closed through the far inset point `(SIDE_REACH, SIDE_REACH)`.
 */
function insideCorner(outline: number[], px: number, py: number): boolean {
  let inside = false
  const count = outline.length / 2
  for (let i = 0; i <= count; i++) {
    // The closing point comes last, then the polygon wraps to the start.
    const ax = i < count ? outline[i * 2] : SIDE_REACH
    const ay = i < count ? outline[i * 2 + 1] : SIDE_REACH
    const next = (i + 1) % (count + 1)
    const bx = next < count ? outline[next * 2] : SIDE_REACH
    const by = next < count ? outline[next * 2 + 1] : SIDE_REACH
    if (ay > py !== by > py && px < ax + ((py - ay) * (bx - ax)) / (by - ay)) {
      inside = !inside
    }
  }
  return inside
}

/**
 * Signed distance from `(px, py)` to `outline`, negative inside the corner,
 * with its gradient: `[distance, gradientX, gradientY]`.
 */
export function outlineDistance(
  outline: number[],
  px: number,
  py: number,
): [number, number, number] {
  let best = Infinity
  let nearX = 0
  let nearY = 0
  let edgeX = 1
  let edgeY = 0
  for (let i = 0; i + 3 < outline.length; i += 2) {
    const ax = outline[i]
    const ay = outline[i + 1]
    const dx = outline[i + 2] - ax
    const dy = outline[i + 3] - ay
    const lengthSq = dx * dx + dy * dy
    // A collapsed arc at full smoothing leaves segments of no length.
    if (lengthSq < 1e-18) continue
    const t = Math.min(
      1,
      Math.max(0, ((px - ax) * dx + (py - ay) * dy) / lengthSq),
    )
    const cx = ax + dx * t
    const cy = ay + dy * t
    const distSq = (px - cx) * (px - cx) + (py - cy) * (py - cy)
    if (distSq < best) {
      best = distSq
      nearX = cx
      nearY = cy
      edgeX = dx
      edgeY = dy
    }
  }
  const inside = insideCorner(outline, px, py)
  const distance = Math.sqrt(best)
  let gx: number
  let gy: number
  if (distance > 1e-9) {
    gx = (px - nearX) / distance
    gy = (py - nearY) / distance
    if (inside) {
      gx = -gx
      gy = -gy
    }
  } else {
    // On the outline, the gradient is the outward normal. With x and y as
    // insets the outline keeps the inside on its right, so outward is left.
    const length = Math.hypot(edgeX, edgeY)
    gx = -edgeY / length
    gy = edgeX / length
  }
  return [inside ? -distance : distance, gx, gy]
}

/** One tile's texels as floats, `(distance, gradientX, gradientY, 0)` each. */
export function buildFieldTile(smoothing: number): Float32Array {
  const outline = cornerOutline(smoothing)
  const texels = new Float32Array(FIELD_TILE_SIZE * FIELD_TILE_SIZE * 4)
  const span = FIELD_PATCH_MAX - FIELD_PATCH_MIN
  for (let row = 0; row < FIELD_TILE_SIZE; row++) {
    const insetY = FIELD_PATCH_MIN + ((row + 0.5) / FIELD_TILE_SIZE) * span
    for (let column = 0; column < FIELD_TILE_SIZE; column++) {
      const insetX = FIELD_PATCH_MIN + ((column + 0.5) / FIELD_TILE_SIZE) * span
      const [distance, gx, gy] = outlineDistance(outline, insetX, insetY)
      const at = (row * FIELD_TILE_SIZE + column) * 4
      texels[at] = distance
      texels[at + 1] = gx
      texels[at + 2] = gy
    }
  }
  return texels
}

/** IEEE half float bits of `value`, rounded to nearest. */
export function toHalf(value: number): number {
  const floats = new Float32Array([value])
  const bits = new Uint32Array(floats.buffer)[0]
  const sign = (bits >>> 16) & 0x8000
  const exponent = ((bits >>> 23) & 0xff) - 127 + 15
  const mantissa = bits & 0x7fffff
  if (exponent <= 0) {
    if (exponent < -10) return sign
    const shifted = (mantissa | 0x800000) >> (1 - exponent)
    return sign | ((shifted + 0x1000) >> 13)
  }
  if (exponent >= 31) return sign | 0x7c00
  return sign | ((exponent << 10) + ((mantissa + 0x1000) >> 13))
}

/** Every tile, as the half floats `squircleField.bin` holds. */
export function buildField(): Uint16Array {
  const out = new Uint16Array(FIELD_WIDTH * FIELD_HEIGHT * 4)
  for (let tile = 0; tile < FIELD_TILE_COUNT; tile++) {
    const texels = buildFieldTile(tile / (FIELD_TILE_COUNT - 1))
    const offset = tile * texels.length
    for (let i = 0; i < texels.length; i++) out[offset + i] = toHalf(texels[i])
  }
  return out
}

let loading: Promise<Uint16Array | null> | null = null

/**
 * The shipped field, fetched once per page. Resolves to `null` for a module
 * served from disk, as in a test environment, which has no server to fetch it
 * from.
 */
export function loadField(): Promise<Uint16Array | null> {
  const url = new URL('./squircleField.bin', import.meta.url)
  if (url.protocol === 'file:') return Promise.resolve(null)
  loading ??= fetch(url)
    .then((response) => {
      if (!response.ok) throw new Error(`squircleField.bin: ${response.status}`)
      return response.arrayBuffer()
    })
    .then((buffer) => new Uint16Array(buffer))
  return loading
}
