/**
 * Live distance-fog settings for the 3D pass. One instance lives on the
 * {@link Engine} (`engine.fog`); the renderer reads it each frame, so changes
 * take effect immediately. Fog blends every 3D surface's color toward
 * {@link Fog.color} by how far it sits from the camera — a cheap way to fade
 * distant geometry into a horizon, cue depth, or hide the far clip plane.
 *
 * Two falloff models: `exp` (`1 - exp(-density·dist)`) never fully saturates,
 * so nothing hard-clips at a set distance; `linear` ramps from clear at
 * {@link Fog.start} to solid at {@link Fog.end}, which is easier to art-direct
 * for a bounded scene. The fog color is a display-space (gamma) RGB triple in
 * `0..1`, applied after tone-mapping so it reads as the literal color you set.
 *
 * @category Render
 * @example
 *   engine.fog.enabled = true
 *   engine.fog.color = [0.6, 0.7, 0.85]
 *   engine.fog.density = 0.05 // exp model (the default)
 *
 * @example
 *   engine.fog.mode = 'linear'
 *   engine.fog.start = 8 // clear up close
 *   engine.fog.end = 40 // solid fog beyond this
 */

/** Fog falloff model. See {@link Fog}. */
export type FogMode = 'exp' | 'linear'

/** Construction overrides for {@link Fog}. */
export interface FogOptions {
  enabled?: boolean
  mode?: FogMode
  /** Display-space (gamma) rgb in `0..1`. */
  color?: [number, number, number]
  /** `exp` model: falloff rate; larger fades sooner. Clamped `>= 0`. */
  density?: number
  /** `linear` model: distance where fog begins. Clamped `>= 0`. */
  start?: number
  /** `linear` model: distance of full fog. Clamped `> start`. */
  end?: number
}

export class Fog {
  /** Master switch; when false the renderer skips fog entirely. */
  enabled = false
  /** Falloff model, `exp` or `linear`. */
  mode: FogMode = 'exp'
  /** Display-space (gamma) rgb in `0..1`. */
  color: [number, number, number] = [0.7, 0.75, 0.8]
  #density = 0.05
  #start = 0
  #end = 50

  constructor(opts: FogOptions = {}) {
    if (opts.enabled !== undefined) this.enabled = opts.enabled
    if (opts.mode !== undefined) this.mode = opts.mode
    if (opts.color !== undefined) this.color = opts.color
    if (opts.density !== undefined) this.density = opts.density
    if (opts.start !== undefined) this.start = opts.start
    if (opts.end !== undefined) this.end = opts.end
  }

  /** `exp` model falloff rate (clamped `>= 0`). */
  get density(): number {
    return this.#density
  }
  set density(v: number) {
    this.#density = Math.max(0, v)
  }

  /** `linear` model distance where fog begins (clamped `>= 0`). */
  get start(): number {
    return this.#start
  }
  set start(v: number) {
    this.#start = Math.max(0, v)
  }

  /** `linear` model distance of full fog (kept strictly greater than start). */
  get end(): number {
    return this.#end
  }
  set end(v: number) {
    this.#end = Math.max(v, this.#start + 1e-4)
  }
}
