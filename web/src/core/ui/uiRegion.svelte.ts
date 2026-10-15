/**
 * The patch of world the screen UI is laid out in, kept current on resize.
 *
 * The UI lives under a layer fitted to the design region, so a UI node at world
 * `(x, y)` sits at the same place on screen whatever the scene's camera does.
 * HTML nodes pin to {@link UiRegion.anchor} with `domAnchor`, and their children
 * lay out in design pixels against `rect`.
 */
import {
  Node2D,
  viewFor,
  type Engine,
  type Layer,
  type Rect,
} from '@src/stargazer'
import { visibleRect, worldPerCssPx } from './designRegion'

export class UiRegion {
  /** A node at the region's top left. HTML nodes pin to it. */
  readonly anchor: Node2D

  /** The visible world rect at the current canvas aspect. */
  rect = $state<Rect>(visibleRect(0, 0))

  /** World units per canvas CSS pixel, for sizes that stay fixed on screen. */
  cssPxInWorld = $state(1)

  readonly #layer: Layer
  readonly #listeners: Array<(rect: Rect) => void> = []
  readonly #offResize: () => void

  /**
   * `layer` must already be in a scene, and fitted to the design region with
   * `space: { frame }`.
   */
  constructor(engine: Engine, layer: Layer) {
    this.#layer = layer
    this.anchor = new Node2D('ui-anchor')
    layer.add(this.anchor)
    this.resize()
    this.#offResize = engine.events.on('resize', () => this.resize())
  }

  /** Refit to the layer's view at the canvas's current size. */
  resize(): void {
    const scene = this.#layer.scene
    const stage = scene?.engine?.stageForScene(scene)
    const view = stage ? viewFor(this.#layer, stage) : null
    if (!view) return
    const rect = view.visibleWorldRect()
    this.anchor.transform.x = rect.x
    this.anchor.transform.y = rect.y
    this.anchor.boundsOverride = {
      x: 0,
      y: 0,
      width: rect.width,
      height: rect.height,
    }
    this.rect = rect
    this.cssPxInWorld = worldPerCssPx(
      stage!.renderer.cssSize.w,
      stage!.renderer.cssSize.h,
    )
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
    this.#offResize()
    this.#listeners.length = 0
    if (!this.anchor.isDestroyed) this.anchor.destroy()
  }
}
