/**
 * The static-layer offscreen buffer. Holds a bitmap of the current
 * `renderLayer: 'static'` subtree rendered at the current camera+DPR. Each
 * frame the main canvas either:
 *
 * - Blits this bitmap (cache hit), a single `drawImage`, cheap even at 4K.
 * - Or, when the camera moved or the cache is stale, either re-bakes now (camera
 *   settled) or renders the static layer fresh (camera animating).
 *
 * ## Why an ImageBitmap and not a plain `<canvas>`
 *
 * In Firefox, drawing FROM a live `<canvas>` that you also draw INTO is a known
 * slow path: the source canvas is often not kept GPU-resident, so the per-frame
 * blit forces a full readback/upload (~33 MB at 4K) and dominates the idle
 * frame. To avoid that we bake into an `OffscreenCanvas` and seal it into an
 * **immutable, GPU-resident `ImageBitmap`** via `transferToImageBitmap()`; the
 * per-frame blit then draws that bitmap, which the browser can keep as a
 * texture. We hold exactly one bitmap in steady state and `close()` the
 * previous one on every rebake so VRAM stays bounded.
 *
 * Where `OffscreenCanvas` / `transferToImageBitmap` is unavailable (older
 * browsers, some test environments) we fall back to the plain-canvas bake +
 * blit, same feature-detect pattern as `Path2DNode`'s scratch context.
 *
 * Bake accounting is tracked here, the debug HUD reads `totalBakes` and derives
 * an "invalidations/s" rate via `DebugController`, and `activeBitmaps` so a
 * texture leak surfaces on the kiosk.
 */
export class Layers {
  // --- ImageBitmap path ---
  private offscreen: OffscreenCanvas | null = null
  private offscreenCtx: CanvasRenderingContext2D | null = null
  private bitmap: ImageBitmap | null = null
  private _activeBitmaps = 0

  // --- Fallback (plain-canvas) path ---
  private fallbackCanvas: HTMLCanvasElement | null = null
  private fallbackCtx: CanvasRenderingContext2D | null = null

  /**
   * True while the ImageBitmap bake path is in use. Seeded from a feature
   * probe, but downgraded permanently to the plain-canvas path the first time
   * an `OffscreenCanvas` 2D context can't actually be acquired, some
   * environments (e.g. happy-dom) expose the API surface but return no
   * context.
   */
  private useBitmap: boolean

  private _pixelW = 0
  private _pixelH = 0
  private _totalBakes = 0

  constructor() {
    // `typeof OffscreenCanvas` short-circuits before touching `.prototype`, so
    // this stays safe when the global is entirely absent.
    this.useBitmap =
      typeof OffscreenCanvas !== 'undefined' &&
      typeof OffscreenCanvas.prototype.transferToImageBitmap === 'function'
  }

  get totalBakes(): number {
    return this._totalBakes
  }

  /**
   * Live (unclosed) `ImageBitmap`s held by the bake. `0` before the first bake,
   * `1` in steady state; the HUD shows it and tests assert it never exceeds
   * `2`. Always `0` on the fallback path.
   */
  get activeBitmaps(): number {
    return this._activeBitmaps
  }

  /**
   * Ensure the offscreen buffer is at least `pixelW × pixelH` and return its 2D
   * context. Recreates the buffer when the size changes; any bitmap baked at
   * the old size is closed so it can't be blitted stale.
   */
  ensureSize(pixelW: number, pixelH: number): CanvasRenderingContext2D {
    if (this.useBitmap) {
      if (this.offscreen !== null && !this.sizeChanged(pixelW, pixelH)) {
        return this.offscreenCtx!
      }
      const offscreen = new OffscreenCanvas(pixelW, pixelH)
      const ctx = offscreen.getContext('2d')
      if (ctx) {
        this.offscreen = offscreen
        // The OffscreenCanvas 2D context exposes the same drawing surface as a
        // CanvasRenderingContext2D; cast so callers (drawLayer / node.draw)
        // stay typed against the on-screen context type.
        this.offscreenCtx = ctx as unknown as CanvasRenderingContext2D
        this._pixelW = pixelW
        this._pixelH = pixelH
        this.closeBitmap()
        return this.offscreenCtx
      }
      // API present but no usable context, downgrade for good and fall
      // through to the plain-canvas path below.
      this.useBitmap = false
      this.offscreen = null
      this.offscreenCtx = null
    }

    if (this.fallbackCanvas === null || this.sizeChanged(pixelW, pixelH)) {
      this.fallbackCanvas = document.createElement('canvas')
      this.fallbackCanvas.width = pixelW
      this.fallbackCanvas.height = pixelH
      const ctx = this.fallbackCanvas.getContext('2d')
      if (!ctx)
        throw new Error('Layers: failed to acquire offscreen 2D context')
      this.fallbackCtx = ctx
      this._pixelW = pixelW
      this._pixelH = pixelH
    }
    return this.fallbackCtx!
  }

  private sizeChanged(pixelW: number, pixelH: number): boolean {
    return this._pixelW !== pixelW || this._pixelH !== pixelH
  }

  /**
   * Clear the offscreen to fully transparent, the main clear color shows
   * through wherever the static layer draws nothing.
   */
  clearBake(): void {
    const ctx = this.useBitmap ? this.offscreenCtx : this.fallbackCtx
    if (!ctx) return
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, this._pixelW, this._pixelH)
  }

  /**
   * Seal the freshly-drawn bake and count it. On the bitmap path this transfers
   * the offscreen's contents into a new immutable `ImageBitmap`
   * (detaching/clearing the offscreen, which is fine, we only ever draw into it
   * immediately before sealing) and closes the previous bitmap.
   */
  recordBake(): void {
    if (this.useBitmap && this.offscreen) {
      const next = this.offscreen.transferToImageBitmap()
      this.closeBitmap()
      this.bitmap = next
      this._activeBitmaps++
    }
    this._totalBakes++
  }

  /** Draw the cached bake onto the destination context. */
  blit(dst: CanvasRenderingContext2D): void {
    dst.setTransform(1, 0, 0, 1, 0, 0)
    if (this.useBitmap) {
      if (this.bitmap) dst.drawImage(this.bitmap, 0, 0)
    } else if (this.fallbackCanvas) {
      dst.drawImage(this.fallbackCanvas, 0, 0)
    }
  }

  /** Close and drop the held bitmap, if any. Keeps `activeBitmaps` honest. */
  private closeBitmap(): void {
    if (this.bitmap) {
      this.bitmap.close()
      this.bitmap = null
      if (this._activeBitmaps > 0) this._activeBitmaps--
    }
  }

  /**
   * Return the freshly-sealed bake so a GPU backend can upload it to a texture.
   * On the ImageBitmap path this is the immutable bitmap produced by the last
   * `recordBake` (the OffscreenCanvas is empty after `transferToImageBitmap`
   * and must NOT be returned here); on the fallback path it's the plain-canvas
   * backing store the bake drew into. `null` before the first `recordBake`,
   * callers must gracefully skip.
   */
  getBakeSource(): CanvasImageSource | null {
    if (this.useBitmap) {
      return this.bitmap
    }
    return this.fallbackCanvas
  }

  /** Release the offscreen buffer + bitmap (called on engine destroy). */
  dispose(): void {
    this.closeBitmap()
    this.offscreen = null
    this.offscreenCtx = null
    this.fallbackCanvas = null
    this.fallbackCtx = null
    this._pixelW = 0
    this._pixelH = 0
  }
}
