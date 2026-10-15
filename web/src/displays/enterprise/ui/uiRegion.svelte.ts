/**
 * The patch of world the screen UI is laid out in, kept current on resize.
 *
 * The UI stage's camera is fixed on {@link visibleRect}, so a UI node at world
 * `(x, y)` sits at the same place on screen whatever the map is doing. HTML
 * nodes pin to {@link UiRegion.anchor} with `domAnchor`, and their children lay
 * out in design pixels against `rect`.
 */
import { CameraNode2D, Node2D, type Rect, type Stage } from '@src/stargazer'
import { visibleRect, worldPerCssPx } from './designRegion'

export class UiRegion {
  /** A node at the region's top left. HTML nodes pin to it. */
  readonly anchor: Node2D

  /** The visible world rect at the current canvas aspect. */
  rect = $state<Rect>(visibleRect(0, 0))

  /** World units per canvas CSS pixel, for sizes that stay fixed on screen. */
  cssPxInWorld = $state(1)

  readonly #camera: CameraNode2D
  readonly #listeners: Array<(rect: Rect) => void> = []

  constructor(stage: Stage) {
    this.#camera = new CameraNode2D('ui-camera')
    stage.tree.root.add(this.#camera)
    this.#camera.makeCurrent()
    this.anchor = new Node2D('ui-anchor')
    stage.tree.root.add(this.anchor)
    this.resize(stage)
  }

  /** Refit to the stage's current canvas size. */
  resize(stage: Stage): void {
    const px = stage.renderer.pixelSize
    const css = stage.renderer.cssSize
    const rect = visibleRect(px.w, px.h)
    this.#camera.setViewport(rect)
    this.anchor.transform.x = rect.x
    this.anchor.transform.y = rect.y
    this.anchor.debugBounds = {
      x: 0,
      y: 0,
      width: rect.width,
      height: rect.height,
    }
    this.rect = rect
    this.cssPxInWorld = worldPerCssPx(css.w, css.h)
    for (const fn of this.#listeners) fn(rect)
  }

  /** Relayout `fn` on every resize, with the new rect. */
  onResize(fn: (rect: Rect) => void): () => void {
    this.#listeners.push(fn)
    return () => {
      const at = this.#listeners.indexOf(fn)
      if (at !== -1) this.#listeners.splice(at, 1)
    }
  }

  destroy(): void {
    this.#listeners.length = 0
    if (!this.anchor.isDestroyed) this.anchor.destroy()
    if (!this.#camera.isDestroyed) this.#camera.destroy()
  }
}
