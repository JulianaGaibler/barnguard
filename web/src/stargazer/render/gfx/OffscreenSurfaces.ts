// Pooled offscreen render surfaces for `Gfx2D.beginOffscreen`.
//
// A surface has the same color format, sample count and depth-stencil aspects
// as the main target, because every 2D pipeline bakes them. With MSAA it is a
// multisampled target plus a single-sample target that receives the resolve and
// is the one a composite samples. Without MSAA it is one target that serves both
// roles.
//
// Surfaces are claimed during a frame and returned together after the frame's
// replay. A returned surface waits in a free list keyed by its size, and is
// deleted after it has gone unused for a while.

import type { ColorFormat, GfxDevice, RenderTarget, Texture } from './GfxDevice'

/** Sizes round up to this many pixels so surfaces of similar size share targets. */
const SIZE_QUANTUM = 64

/** Frames a free surface survives without being claimed. */
const IDLE_FRAMES = 120

/** The attachment signature surfaces are created with. */
export interface SurfaceFormat {
  colorSpace: ColorFormat
  samples: number
  depth: boolean
  stencil: boolean
}

/**
 * An offscreen surface. `rect` is where it sits in the target it was opened in,
 * in that target's pixels. The texture may be larger than `rect` (sizes round
 * up), and only the top-left `rect.w × rect.h` pixels are used.
 */
export interface Surface {
  /** The target passes draw into. Multisampled when the main target is. */
  readonly draw: RenderTarget
  /** The single-sample target holding the result. Same as `draw` without MSAA. */
  readonly resolve: RenderTarget
  /** The sampleable result texture. */
  readonly tex: Texture
  /** Allocated size in pixels. */
  readonly texW: number
  readonly texH: number
  /** Used size in pixels. */
  w: number
  h: number
  /** Origin in the parent target's pixels. */
  x: number
  y: number
  /** Whether `draw` is a separate multisampled target. */
  readonly multisampled: boolean
  /** The color the surface's pass clears to, premultiplied. Set per claim. */
  clear: [number, number, number, number]
  /** @internal pool bookkeeping */
  bytes: number
  key: string
  idle: number
  inUse: boolean
}

function quantize(v: number): number {
  return Math.ceil(v / SIZE_QUANTUM) * SIZE_QUANTUM
}

export class SurfacePool {
  readonly #device: GfxDevice
  readonly #all: Surface[] = []
  /** Bytes of surface storage currently allocated, for the debug HUD. */
  #bytes = 0
  /** Surfaces created since startup. */
  #created = 0

  constructor(device: GfxDevice) {
    this.#device = device
  }

  /** Approximate bytes of render-target storage held by the pool. */
  get bytes(): number {
    return this.#bytes
  }

  /** Surfaces allocated since startup. */
  get created(): number {
    return this.#created
  }

  /**
   * Claim a surface of at least `w × h` in `format`. With `exact` the texture
   * is exactly `w × h`, for content a shader positions by the texture's own
   * size, and it is only reused for the same size.
   */
  acquire(w: number, h: number, format: SurfaceFormat, exact = false): Surface {
    const tw = exact ? w : quantize(w)
    const th = exact ? h : quantize(h)
    const key = `${tw}x${th}:${format.colorSpace}:${format.samples}:${format.depth}:${format.stencil}${exact ? ':exact' : ''}`
    for (const s of this.#all) {
      if (!s.inUse && s.key === key) {
        s.inUse = true
        s.idle = 0
        s.w = w
        s.h = h
        s.clear = [0, 0, 0, 0]
        return s
      }
    }
    const device = this.#device
    const multisampled = format.samples > 1
    const draw = device.createRenderTarget({
      width: tw,
      height: th,
      samples: format.samples,
      depth: format.depth,
      stencil: format.stencil,
      colorSpace: format.colorSpace,
    })
    const resolve = multisampled
      ? device.createRenderTarget({
          width: tw,
          height: th,
          samples: 1,
          colorSpace: format.colorSpace,
        })
      : draw
    const surface: Surface = {
      draw,
      resolve,
      tex: device.colorTexture(resolve),
      texW: tw,
      texH: th,
      w,
      h,
      x: 0,
      y: 0,
      multisampled,
      clear: [0, 0, 0, 0],
      bytes: tw * th * 4 * (multisampled ? format.samples + 1 : 1),
      key,
      idle: 0,
      inUse: true,
    }
    this.#bytes += surface.bytes
    this.#created++
    this.#all.push(surface)
    return surface
  }

  /** Return every claimed surface and delete the ones idle for too long. */
  endFrame(): void {
    for (let i = this.#all.length - 1; i >= 0; i--) {
      const s = this.#all[i]
      if (s.inUse) {
        s.inUse = false
        s.idle = 0
      } else if (++s.idle > IDLE_FRAMES) {
        this.#destroy(s)
        this.#all.splice(i, 1)
      }
    }
  }

  /** Delete every surface. */
  dispose(): void {
    for (const s of this.#all) this.#destroy(s)
    this.#all.length = 0
  }

  #destroy(s: Surface): void {
    const device = this.#device
    if (s.multisampled) device.deleteRenderTarget(s.draw)
    device.deleteRenderTarget(s.resolve)
    this.#bytes -= s.bytes
  }
}
