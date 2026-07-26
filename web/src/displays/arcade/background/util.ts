import type { CameraView2D, GfxGradientStop, Rect } from '@src/stargazer'
import { rgbaStr, type GradientStopN } from './palette'

/**
 * The world rect currently mapped onto the FULL canvas. The camera fits its
 * `viewport` aspect-preserving, so on off-aspect screens this is larger than
 * the viewport — background layers fill it to reach the canvas edges (no
 * letterbox bars). Thin wrapper over {@link CameraView2D.visibleWorldRect} (kept
 * for the background nodes that already call it).
 */
export function visibleWorldRect(camera: CameraView2D, out?: Rect): Rect {
  return camera.visibleWorldRect(out)
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
