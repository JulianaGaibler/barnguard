/**
 * Static-layer offscreen buffer. Holds a bitmap of the current
 * `renderLayer: 'static'` subtree at the current camera + DPR. Each frame
 * the main canvas either blits it (cache hit) or re-bakes (camera settled)
 * / renders live (camera animating).
 *
 * Bakes into an `OffscreenCanvas` and seals into an immutable, GPU-resident
 * `ImageBitmap` via `transferToImageBitmap()`. Firefox keeps a live source
 * canvas off-GPU, so per-frame blits force a ~33 MB readback at 4K, sealing
 * to a bitmap avoids that. Steady state holds exactly one bitmap, previous
 * is `close()`d on every rebake so VRAM stays bounded.
 *
 * Falls back to plain-canvas bake + blit where `OffscreenCanvas` /
 * `transferToImageBitmap` is unavailable.
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
   * True while the ImageBitmap bake path is active. Feature-probed, then
   * downgraded permanently to plain-canvas on the first failed `getContext`
   * (happy-dom exposes the surface but returns no context).
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
   * Live (unclosed) `ImageBitmap`s. 0 before first bake, 1 in steady state.
   * Tests assert it never exceeds 2. Always 0 on the fallback path.
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
   * Seal the fresh bake and count it. On the bitmap path, transfers the
   * offscreen into a new immutable `ImageBitmap` and closes the previous.
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
   * Sealed bake, for GPU texture upload. Bitmap path returns the immutable
   * bitmap (NOT the offscreen, which is emptied by `transferToImageBitmap`).
   * Fallback returns the plain canvas. `null` before the first `recordBake`.
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
