/**
 * The patch of world a game draws into, kept current on resize.
 *
 * All of it is the arcade's own geometry: where the game region sits, how much
 * of it a non-16:9 canvas reveals, and how far the booth's corner gesture
 * reaches in. The shell computes it once and every game reads the same values,
 * rather than each one repeating the arithmetic and the anchor bookkeeping.
 */
import { Node2D, type Engine, type Rect } from '@src/stargazer'
import {
  REGION_HEIGHT,
  REGION_WIDTH,
  boothCornerInset,
  gameVisibleRect,
  worldPerCssPx,
} from '../world'

export class GameRegion {
  /**
   * Node at the region's top-left, in world space. Overlays pin to it with
   * `domAnchor` so they ride the camera on the pan in and out.
   */
  readonly anchor: Node2D

  /**
   * The region's visible world rect at the current canvas aspect. Wider or
   * taller than 1920 x 1080 on anything but 16:9, which is why game layout
   * reads this and never the constants.
   */
  rect = $state<Rect>({
    x: 0,
    y: 0,
    width: REGION_WIDTH,
    height: REGION_HEIGHT,
  })

  /**
   * How far the booth's corner gesture reaches into the region, in world units.
   * Chrome a game puts in a top corner has to clear it, or the attendant
   * gesture eats its taps. See {@link boothCornerInset}.
   */
  cornerInset = $state(0)

  /**
   * World units per canvas CSS pixel while the region is framed. Converts a
   * size that has to stay fixed on screen, a tap target or a hairline, into the
   * world units game layout is written in. See {@link worldPerCssPx}.
   */
  cssPxInWorld = $state(1)

  readonly #listeners: Array<(rect: Rect) => void> = []
  readonly #offResize: () => void

  constructor(engine: Engine) {
    this.anchor = new Node2D('game-region-anchor')
    engine.tree.root.add(this.anchor)
    const px = engine.renderer.pixelSize
    const css = engine.renderer.cssSize
    this.#apply(px.w, px.h, css.w, css.h)
    this.#offResize = engine.events.on('resize', (e) => {
      this.#apply(e.pixel.w, e.pixel.h, e.css.w, e.css.h)
      for (const fn of this.#listeners) fn(this.rect)
    })
  }

  /**
   * Relayout `fn` on every resize, with the new rect.
   *
   * Games subscribe here rather than to the engine, so the region is already up
   * to date by the time they read it.
   */
  onResize(fn: (rect: Rect) => void): () => void {
    this.#listeners.push(fn)
    return () => {
      const at = this.#listeners.indexOf(fn)
      if (at !== -1) this.#listeners.splice(at, 1)
    }
  }

  destroy(): void {
    this.#offResize()
    this.#listeners.length = 0
    if (!this.anchor.isDestroyed) this.anchor.destroy()
  }

  #apply(pixelW: number, pixelH: number, cssW: number, cssH: number): void {
    const rect = gameVisibleRect(pixelW, pixelH)
    this.anchor.transform.x = rect.x
    this.anchor.transform.y = rect.y
    this.anchor.debugBounds = {
      x: 0,
      y: 0,
      width: rect.width,
      height: rect.height,
    }
    this.rect = rect
    this.cornerInset = boothCornerInset(cssW, cssH)
    this.cssPxInWorld = worldPerCssPx(cssW, cssH)
  }
}
