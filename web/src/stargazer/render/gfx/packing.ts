// Pure CPU-side packing helpers shared by the GPU draw programs: CSS color ->
// premultiplied unorm8×4, dash resolution, vertex writers, and paint
// resolution (the one place that tells a flat color from a gradient).

import { parseColor, type RGBA } from './parseColor'
import type { GfxFill, GfxPaint } from './Gfx2D'

/**
 * Pack an already-parsed color into a little-endian premultiplied `unorm8×4`
 * (byte 0 = R … byte 3 = A), folding `alpha` (the current draw alpha, times
 * anything else the caller wants to fold in, e.g. a fringe vertex's
 * coverage) into the result. WebGL's `UNSIGNED_BYTE` reader consumes the
 * bytes in memory order.
 */
export function packRgba(rgba: RGBA, alpha: number): number {
  const a01 = alpha * rgba.a
  const r = Math.max(0, Math.min(255, Math.round(rgba.r * a01 * 255)))
  const g = Math.max(0, Math.min(255, Math.round(rgba.g * a01 * 255)))
  const b = Math.max(0, Math.min(255, Math.round(rgba.b * a01 * 255)))
  const a = Math.max(0, Math.min(255, Math.round(a01 * 255)))
  return (a << 24) | (b << 16) | (g << 8) | r
}

/** Parse a CSS color and pack it, see {@link packRgba}. */
export function packColor(css: string, alpha: number): number {
  return packRgba(parseColor(css), alpha)
}

export function rgbaTuple(c: RGBA): readonly [number, number, number, number] {
  return [c.r, c.g, c.b, c.a]
}

/** A fill resolved to what it actually is. The one place that discriminates. */
export type ResolvedPaint =
  | { kind: 'solid'; packedColor: number }
  | { kind: 'gradient'; paint: GfxPaint }

/**
 * Tell a flat color from a gradient paint. `alpha` (the current draw alpha)
 * folds into `packedColor` for the solid case; a gradient's stops carry their
 * own alpha already, so the caller applies `alpha` separately as a per-run
 * multiplier (the ramp can't bake it: the atlas row is shared by content, not
 * by caller).
 */
export function resolvePaint(fill: GfxFill, alpha: number): ResolvedPaint {
  if (typeof fill === 'string') {
    return { kind: 'solid', packedColor: packColor(fill, alpha) }
  }
  return { kind: 'gradient', paint: fill }
}

/**
 * Device-space axis projection for a linear gradient (WebRender's
 * formulation): `t` at device-px fragment position `p` is
 * `clamp(dot(p, scaleDir) - startOffset, 0, 1)`. `x0,y0,x1,y1` must already
 * be in device px (the caller transforms the gradient's local endpoints the
 * same way it transforms the geometry).
 */
export function gradientAxis(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): { scaleDirX: number; scaleDirY: number; startOffset: number } {
  const dx = x1 - x0
  const dy = y1 - y0
  const len2 = dx * dx + dy * dy
  const invLen2 = len2 > 0 ? 1 / len2 : 0
  const scaleDirX = dx * invLen2
  const scaleDirY = dy * invLen2
  const startOffset = x0 * scaleDirX + y0 * scaleDirY
  return { scaleDirX, scaleDirY, startOffset }
}

/**
 * Canvas `[on, off, ...]` dash -> `(dashStart, dashPeriod, dashOnLen)` in device
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

/** HSV -> RGB. Hue in `[0, 6)` sector space. `'batch-color'` debug helper. */
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
