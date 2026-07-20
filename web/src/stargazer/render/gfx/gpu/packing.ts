// Pure CPU-side packing helpers shared by the GPU draw programs: CSS color →
// premultiplied unorm8×4, dash resolution, and vertex writers.

import { parseColor, type RGBA } from '../parseColor'

/**
 * Parse a CSS color and pack it into a little-endian premultiplied `unorm8×4`
 * (byte 0 = R … byte 3 = A), folding `alpha` (the current draw alpha) into the
 * result. WebGL's `UNSIGNED_BYTE` reader consumes the bytes in memory order.
 */
export function packColor(css: string, alpha: number): number {
  const rgba = parseColor(css)
  const a01 = alpha * rgba.a
  const r = Math.max(0, Math.min(255, Math.round(rgba.r * a01 * 255)))
  const g = Math.max(0, Math.min(255, Math.round(rgba.g * a01 * 255)))
  const b = Math.max(0, Math.min(255, Math.round(rgba.b * a01 * 255)))
  const a = Math.max(0, Math.min(255, Math.round(a01 * 255)))
  return (a << 24) | (b << 16) | (g << 8) | r
}

export function rgbaTuple(c: RGBA): readonly [number, number, number, number] {
  return [c.r, c.g, c.b, c.a]
}

/**
 * Canvas `[on, off, ...]` dash → `(dashStart, dashPeriod, dashOnLen)` in device
 * px. Only the first `[on, off]` pair is honored (matches the game's 2-element
 * usage). `dashPeriod === 0` disables dashing in the shader.
 */
export function resolveDash(
  dash: readonly number[] | undefined,
  scale = 1,
): { dashStart: number; dashPeriod: number; dashOnLen: number } {
  if (!dash || dash.length < 2) {
    return { dashStart: 0, dashPeriod: 0, dashOnLen: 0 }
  }
  const on = dash[0] * scale
  const off = dash[1] * scale
  return { dashStart: 0, dashPeriod: on + off, dashOnLen: on }
}

/**
 * Write one colored-tri vertex. Pos and UV via float view, packed color via
 * uint view. Both views alias the same ArrayBuffer.
 */
export function writeColoredVert(
  fv: Float32Array,
  uv: Uint32Array,
  off: number,
  x: number,
  y: number,
  packedColor: number,
  u: number,
  v: number,
): void {
  fv[off] = x
  fv[off + 1] = y
  uv[off + 2] = packedColor >>> 0
  fv[off + 3] = u
  fv[off + 4] = v
}

/** HSV → RGB. Hue in `[0, 6)` sector space. `'batch-color'` debug helper. */
export function hsvToRgb(
  h: number,
  s: number,
  v: number,
): [number, number, number] {
  const i = Math.floor(h)
  const f = h - i
  const p = v * (1 - s)
  const q = v * (1 - s * f)
  const t = v * (1 - s * (1 - f))
  switch (i % 6) {
    case 0:
      return [v, t, p]
    case 1:
      return [q, v, p]
    case 2:
      return [p, v, t]
    case 3:
      return [p, q, v]
    case 4:
      return [t, p, v]
    default:
      return [v, p, q]
  }
}
