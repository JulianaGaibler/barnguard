import type { Camera, GfxGradientStop, Rect } from '@src/stargazer'
import { rgbaStr, type GradientStopN } from './palette'

/**
 * The world rect currently mapped onto the FULL canvas. The camera fits its
 * `viewport` aspect-preserving (letterbox), so on off-aspect screens this is
 * larger than the viewport — background layers fill it to reach the canvas
 * edges (no letterbox bars).
 */
export function visibleWorldRect(camera: Camera, out?: Rect): Rect {
  const t = camera.getScreenTransform()
  const pw = camera.pixelSize.w
  const ph = camera.pixelSize.h
  const r = out ?? { x: 0, y: 0, width: 0, height: 0 }
  if (t.scale <= 0 || pw <= 0 || ph <= 0) {
    r.x = camera.viewport.x
    r.y = camera.viewport.y
    r.width = camera.viewport.width
    r.height = camera.viewport.height
    return r
  }
  const x0 = (0 - t.offsetX) / t.scale
  const y0 = (0 - t.offsetY) / t.scale
  const x1 = (pw - t.offsetX) / t.scale
  const y1 = (ph - t.offsetY) / t.scale
  r.x = x0
  r.y = y0
  r.width = x1 - x0
  r.height = y1 - y0
  return r
}

/**
 * Converts palette stop tuples to `GfxGradientStop[]`, caching by palette
 * version so the array IDENTITY is stable while the palette is unchanged — the
 * GPU LUT is keyed on that identity, so this keeps it upload-once at steady
 * state (it only rebuilds during a transition).
 */
export class StopsCache {
  #version = -1
  #cached: GfxGradientStop[] = []

  get(version: number, stops: GradientStopN[]): GfxGradientStop[] {
    if (version !== this.#version) {
      this.#version = version
      this.#cached = stops.map((s) => ({
        offset: s.offset,
        color: rgbaStr(s.color),
      }))
    }
    return this.#cached
  }
}
