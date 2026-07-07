export interface RendererOptions {
  canvas: HTMLCanvasElement
  clearColor?: string
  /**
   * When true the frame clear leaves the canvas transparent so a CSS background
   * behind it shows through. `clearColor` is ignored in this mode.
   */
  transparent?: boolean
}

/**
 * Owns the canvas element, DPR bookkeeping, and CSS/pixel sizing. Under
 * `?renderer=canvas2d` a `Canvas2DGfx` facade takes ownership of the 2D
 * context; under `?renderer=gpu` a `GpuGfx` (backed by a `WebGL2Device`) takes
 * ownership of the WebGL2 context. Renderer itself is renderer-agnostic , every
 * drawing operation and every context acquisition goes through the facade layer
 * above.
 *
 * The clear color + transparent flag are carried through as configuration for
 * the facade to consume on `beginFrame`.
 */
export class Renderer {
  readonly canvas: HTMLCanvasElement
  clearColor: string
  transparent: boolean
  dpr = 1
  cssSize: { w: number; h: number } = { w: 0, h: 0 }
  pixelSize: { w: number; h: number } = { w: 0, h: 0 }

  constructor(opts: RendererOptions) {
    this.canvas = opts.canvas
    this.clearColor = opts.clearColor ?? '#0d1a2c'
    this.transparent = opts.transparent ?? false
  }

  /**
   * Resize the canvas backing store to `cssW × cssH × dpr` device pixels.
   * Writing to `canvas.width`/`canvas.height` is the standard mechanism for
   * both context types (the WebGL2 default framebuffer is sized by this write);
   * the FBO GpuGfx renders into is managed separately via
   * `screenGfx.setInternalSize`.
   */
  resize(cssW: number, cssH: number, dpr: number): void {
    this.dpr = dpr
    this.cssSize = { w: cssW, h: cssH }
    this.pixelSize = { w: Math.round(cssW * dpr), h: Math.round(cssH * dpr) }
    this.canvas.width = this.pixelSize.w
    this.canvas.height = this.pixelSize.h
  }
}
