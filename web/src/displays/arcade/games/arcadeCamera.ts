import {
  easings,
  ignoreAbort,
  type CameraNode2D,
  type Rect,
} from '@src/stargazer'

/** Framing-tween options a game can pass through to the leased camera. */
export interface ArcadeCameraAnimateOptions {
  /** Seconds; defaults to the arcade's standard `0.6`. */
  duration?: number
  easing?: (t: number) => number
}

/**
 * A lease over the arcade's single shared 2D camera, handed to a game via
 * `GameProps` so it can frame sub-rects of its region — e.g. a zoom into a
 * detail — without owning the camera. Most games ignore it and render at the
 * region's `home()` framing; games that zoom (Data Control) drive it here.
 *
 * The arcade reclaims control on exit via {@link release}, which settles any
 * pending animation so a game `await`ing a zoom can't hang while it's being
 * torn down. `release()` also stops the lease honoring further framing calls,
 * so a late in-flight zoom can't fight the arcade's pan back to the launcher.
 */
export class ArcadeCamera {
  readonly #camera: CameraNode2D
  readonly #home: Rect
  #framing: Rect
  #released = false
  readonly #pendingSettles = new Set<() => void>()

  constructor(camera: CameraNode2D, home: Rect) {
    this.#camera = camera
    this.#home = home
    this.#framing = home
  }

  /** The game region's default framing (what the arcade pans to on Play). */
  home(): Rect {
    return this.#home
  }

  /** The world rect the camera frames right now (tracks a tween in progress). */
  get viewport(): Rect {
    return this.#camera.viewport
  }

  /**
   * The last-requested framing target. The arcade re-applies this on resize
   * (instead of forcing the region's home framing) so a game that has zoomed in
   * stays zoomed after a window resize.
   */
  get framing(): Rect {
    return this.#framing
  }

  get released(): boolean {
    return this.#released
  }

  /** Snap the framing immediately, no tween. */
  snapTo(rect: Rect): void {
    if (this.#released) return
    this.#framing = rect
    this.#camera.setViewport(rect)
  }

  /**
   * Tween the framing to `rect`. Resolves when the tween finishes OR the lease
   * is released — whichever comes first — so an `await` on a zoom never hangs
   * when the arcade reclaims the camera mid-move.
   */
  animateTo(rect: Rect, opts?: ArcadeCameraAnimateOptions): Promise<void> {
    if (this.#released) return Promise.resolve()
    this.#framing = rect
    return new Promise<void>((resolve) => {
      let done = false
      const settle = (): void => {
        if (done) return
        done = true
        this.#pendingSettles.delete(settle)
        resolve()
      }
      this.#pendingSettles.add(settle)
      this.#camera
        .animateTo(rect, {
          duration: opts?.duration ?? 0.6,
          easing: opts?.easing ?? easings.inOutCubic,
        })
        .catch(ignoreAbort)
        .finally(settle)
    })
  }

  /** Reclaim the camera: settle any pending animation; further calls no-op. */
  release(): void {
    if (this.#released) return
    this.#released = true
    for (const settle of [...this.#pendingSettles]) settle()
  }
}
