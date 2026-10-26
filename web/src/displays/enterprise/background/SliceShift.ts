import { postShader } from 'stargazer'
import type { PostEffect, PostPass, ShaderReflection } from 'stargazer'
import wgsl from './sliceShift.wgsl?raw'
import vertSrc from './sliceShift.gen.vert.glsl?raw'
import fragSrc from './sliceShift.gen.frag.glsl?raw'
import reflect from './sliceShift.reflect.json'

/** Construction overrides for {@link SliceShift}. */
export interface SliceShiftOptions {
  enabled?: boolean
  /** Displacement in units of `barWidth`. Figma default `50`. */
  shift?: number
  /** Rotation of the slice axis, in degrees. Figma default `0`. */
  angle?: number
  /** Anchor X, in percent of the frame width. Figma default `50`. */
  centerX?: number
  /** Anchor Y, in percent of the frame height. Figma default `50`. */
  centerY?: number
  /**
   * Column width, in render-target pixels. The caller converts from CSS pixels
   * (`cssWidth * devicePixelRatio * renderScale`), the same convention as
   * `FilmGrain.cellPx`. Figma default `100`. Ignored while `columns` is set.
   */
  barWidth?: number
  /**
   * Column count for the frame, recomputing `barWidth` from the frame's own
   * width every frame so the count holds across a resize or a `renderScale`
   * change. Overrides `barWidth` while set. `null` (default) uses `barWidth` as
   * a fixed pixel width instead.
   */
  columns?: number | null
}

/**
 * Column displacement ("slice shift"): slices the frame into bars along a
 * rotated axis and shifts each bar along that axis by `shift` (in units of
 * `barWidth`), proportional to its distance from `(centerX, centerY)`. One
 * fullscreen pass. See `sliceShift.wgsl` for the shader and the Figma-parity
 * notes.
 *
 * @example
 *   engine.postProcess.add(new SliceShift({ shift: 50, angle: 12 }))
 */
export class SliceShift implements PostEffect {
  enabled: boolean
  /** Displacement in units of `barWidth`. Tweakable live. */
  shift: number
  /** Rotation of the slice axis, in degrees. Tweakable live. */
  angle: number
  /** Anchor X, in percent of the frame width. Tweakable live. */
  centerX: number
  /** Anchor Y, in percent of the frame height. Tweakable live. */
  centerY: number
  /** Column width, in render-target pixels. Ignored while `columns` is set. */
  barWidth: number
  /** Column count, recomputing `barWidth` from the frame width. Tweakable live. */
  columns: number | null
  readonly passes: readonly PostPass[]

  constructor(opts: SliceShiftOptions = {}) {
    this.enabled = opts.enabled ?? true
    this.shift = opts.shift ?? 50
    this.angle = opts.angle ?? 0
    this.centerX = opts.centerX ?? 50
    this.centerY = opts.centerY ?? 50
    this.barWidth = opts.barWidth ?? 100
    this.columns = opts.columns ?? null
    this.passes = [
      {
        shader: postShader(vertSrc, fragSrc, wgsl, reflect as ShaderReflection),
        paramsBytes: 32, // vec4 p0 + vec4 p1
        writeParams: (ctx, out) => {
          // Figma's convention is y growing downward. WebGPU's uv matches it
          // (uvYDown true); WebGL2's does not, so the angle and the anchor's
          // y both flip there to land on the same on-screen result.
          const angleDeg = ctx.uvYDown ? this.angle : -this.angle
          const centerY = ctx.uvYDown ? this.centerY : 100 - this.centerY
          const a = (-angleDeg * Math.PI) / 180
          const barWidth =
            this.columns !== null ? ctx.width / this.columns : this.barWidth

          out[0] = Math.cos(a)
          out[1] = Math.sin(a)
          out[2] = ctx.width
          out[3] = ctx.height
          out[4] = this.centerX
          out[5] = centerY
          out[6] = Math.max(Math.abs(barWidth), 0.0001)
          out[7] = this.shift * 0.01
        },
      },
    ]
  }
}
