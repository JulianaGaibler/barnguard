import type { Rect } from '../math/Rect'
import type { Vec2 } from '../math/Vec2'
import type { Engine } from '../engine/Engine'
import type { Easing } from '../math/easings'

/**
 * Uniform aspect-preserving screen transform. All three fields are in CSS pixel
 * space, the renderer applies DPR separately as a baseline factor.
 *
 * ScreenX = worldX * scale + offsetX screenY = worldY * scale + offsetY
 *
 * @category Camera
 */
export interface ScreenTransform {
  scale: number
  offsetX: number
  offsetY: number
}

/**
 * Options for {@link Camera.animateTo}.
 *
 * @category Camera
 */
export interface CameraAnimateOptions {
  /** Total duration in seconds. Default 0.5. */
  duration?: number
  /** Seconds to wait before advancing. */
  delay?: number
  easing?: Easing
  signal?: AbortSignal
}

/**
 * A rectangular window into world coordinates that the renderer fits into the
 * canvas at a uniform, aspect-preserving scale (`contain`-style). Where the
 * fitted region doesn't cover the canvas the clear color shows through, so
 * there are no letterbox bars and no distortion.
 *
 * Pan and zoom by changing {@link Camera.viewport} through
 * {@link Camera.setViewport}, or animate it with {@link Camera.animateTo}.
 * Convert between coordinate spaces with {@link Camera.worldToScreen} and
 * {@link Camera.screenToWorld}.
 *
 * Each `Stage` owns one camera. The debug HUD can swap in its own camera to
 * inspect a stage without disturbing the game camera.
 *
 * @category Camera
 */
export class Camera {
  /**
   * World-space rect the camera frames. Change it through
   * {@link Camera.setViewport} rather than mutating in place, the setter bumps
   * the frame counter that invalidates the cached screen transform.
   */
  viewport: Rect
  /**
   * Canvas size in CSS pixels the viewport fits into. Kept in sync by the
   * stage.
   */
  pixelSize: { w: number; h: number }
  /**
   * Set by the owning `Engine` immediately after construction. Null when the
   * Camera is used standalone (unit tests, temporary throwaway cameras). Only
   * `animateTo` needs it.
   */
  engine: Engine | null = null
  #_frameNum = 0

  // Per-viewport/pixelSize cache for `getScreenTransform()`. The mapping is a
  // pure function of `viewport` and `pixelSize`, both of which bump
  // `_frameNum` when they change, so the frame-num tag doubles as a cache
  // key. Callers who pass an explicit `out` parameter bypass the cache.
  readonly #_cachedScreenTransform: ScreenTransform = {
    scale: 0,
    offsetX: 0,
    offsetY: 0,
  }
  #_cachedScreenTransformFrameNum = -1

  constructor(
    viewport: Rect,
    pixelSize: { w: number; h: number } = { w: 0, h: 0 },
  ) {
    this.viewport = { ...viewport }
    this.pixelSize = { ...pixelSize }
  }

  get frameNum(): number {
    return this.#_frameNum
  }

  setViewport(v: Rect): void {
    if (
      this.viewport.x === v.x &&
      this.viewport.y === v.y &&
      this.viewport.width === v.width &&
      this.viewport.height === v.height
    ) {
      return
    }
    this.viewport = { ...v }
    this.#_frameNum++
  }

  setPixelSize(w: number, h: number): void {
    if (this.pixelSize.w === w && this.pixelSize.h === h) return
    this.pixelSize = { w, h }
    this.#_frameNum++
  }

  /**
   * Uniform world→screen mapping. Without `out`, returns a cached object
   * memoised against `viewport` + `pixelSize` (invalidated whenever either
   * changes via `setViewport` / `setPixelSize`, both of which bump
   * `_frameNum`). Callers MUST NOT mutate the cached result, treat it as
   * read-only. Pass `out` to receive a private copy that's safe to mutate.
   */
  getScreenTransform(out?: ScreenTransform): ScreenTransform {
    if (out) return this.#_computeScreenTransform(out)
    if (this.#_cachedScreenTransformFrameNum !== this.#_frameNum) {
      this.#_computeScreenTransform(this.#_cachedScreenTransform)
      this.#_cachedScreenTransformFrameNum = this.#_frameNum
    }
    return this.#_cachedScreenTransform
  }

  #_computeScreenTransform(t: ScreenTransform): ScreenTransform {
    const vw = this.viewport.width
    const vh = this.viewport.height
    const pw = this.pixelSize.w
    const ph = this.pixelSize.h
    if (vw <= 0 || vh <= 0 || pw <= 0 || ph <= 0) {
      t.scale = 0
      t.offsetX = 0
      t.offsetY = 0
      return t
    }
    // Uniform scale: fit the whole world viewport into the pixel viewport.
    const scale = Math.min(pw / vw, ph / vh)
    // Center the fitted world region within the pixel viewport.
    const usedW = vw * scale
    const usedH = vh * scale
    t.scale = scale
    t.offsetX = (pw - usedW) / 2 - this.viewport.x * scale
    t.offsetY = (ph - usedH) / 2 - this.viewport.y * scale
    return t
  }

  /** Map a world-space point to CSS-pixel canvas coordinates. */
  worldToScreen(x: number, y: number, out?: Vec2): Vec2 {
    const t = this.getScreenTransform()
    const sx = x * t.scale + t.offsetX
    const sy = y * t.scale + t.offsetY
    if (out) {
      out.x = sx
      out.y = sy
      return out
    }
    return { x: sx, y: sy }
  }

  /**
   * Map a CSS-pixel canvas point back to world space, e.g. a pointer position
   * into world coordinates. Returns `(0, 0)` while the transform is degenerate
   * (zero-size viewport or canvas, during initial resize).
   */
  screenToWorld(x: number, y: number, out?: Vec2): Vec2 {
    const t = this.getScreenTransform()
    if (t.scale === 0) {
      if (out) {
        out.x = 0
        out.y = 0
        return out
      }
      return { x: 0, y: 0 }
    }
    const wx = (x - t.offsetX) / t.scale
    const wy = (y - t.offsetY) / t.scale
    if (out) {
      out.x = wx
      out.y = wy
      return out
    }
    return { x: wx, y: wy }
  }

  /** Uniform screen-CSS-px per world unit, same on both axes. */
  screenPxPerWorldUnit(): number {
    return this.getScreenTransform().scale
  }

  /**
   * Multiplier for stroke widths and dash entries when a node wants them
   * expressed in CSS pixels instead of world units. Multiply the CSS-px value
   * by this before passing it to `ctx.lineWidth` (or into a dash array) inside
   * a node's `draw`. The engine's per-node transform then re-scales by `dpr ×
   * camera.scale`; the camera scale cancels out and the resulting device-pixel
   * stroke tracks DPR (the "1 CSS px" invariant).
   *
   * Guards against a degenerate `screenPxPerWorldUnit()` of `0` during initial
   * resize, returns `1` in that window so first-frame draws are still stable.
   */
  strokeSpaceScale(): number {
    const scale = this.getScreenTransform().scale
    return scale > 0 ? 1 / scale : 1
  }

  /**
   * Animate {@link Camera.viewport} from its current value to `target` (a
   * pan-and-zoom). The static-layer cache is skipped during the tween and
   * re-baked once on settle, so a zoom stays crisp. Resolves when the tween
   * completes, rejects with `AbortError` if `opts.signal` aborts. Requires the
   * camera to be attached to an {@link Engine} (every stage camera is).
   *
   * @example
   *   // Zoom in on a 200×200 world region over 0.8s.
   *   await camera.animateTo(
   *     { x: 300, y: 300, width: 200, height: 200 },
   *     { duration: 0.8, easing: easings.inOutCubic },
   *   )
   */
  async animateTo(
    target: Rect,
    opts: CameraAnimateOptions = {},
  ): Promise<void> {
    const engine = this.engine
    if (!engine) {
      throw new Error(
        'Camera.animateTo: this camera is not attached to an Engine',
      )
    }
    const scratch = {
      x: this.viewport.x,
      y: this.viewport.y,
      w: this.viewport.width,
      h: this.viewport.height,
    }
    await engine.animation.tween(
      scratch,
      { x: target.x, y: target.y, w: target.width, h: target.height },
      {
        duration: opts.duration ?? 0.5,
        delay: opts.delay,
        easing: opts.easing,
        signal: opts.signal,
        onUpdate: () => {
          this.setViewport({
            x: scratch.x,
            y: scratch.y,
            width: scratch.w,
            height: scratch.h,
          })
        },
      },
    )
    // Ensure we land exactly on the target values (rounding-tolerant).
    this.setViewport({ ...target })
  }
}
