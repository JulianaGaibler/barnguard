import type { GfxGradientStop } from 'stargazer'
import { rgbaStr, type GradientStopN } from './palette'

/**
 * Converts palette stop tuples to `GfxGradientStop[]`, caching by palette
 * version so the array IDENTITY is stable while the palette is unchanged. The
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
