/**
 * {@link LayoutRoot}: the driver that turns a subtree of {@link Measurable} nodes
 * into a responsive layout. It fills a bounds rect (the camera's visible world
 * area by default), re-runs when the window resizes or a descendant marks
 * itself dirty, and is otherwise idle.
 *
 * @module
 * @category Layout
 */
import { SceneNode } from '../scene/SceneNode'
import type { Scene } from '../scene/Scene'
import type { Camera } from '../camera/Camera'
import type { Rect } from '../math/Rect'
import { BoxConstraints } from './constraints'
import { assertFiniteSize, type Measurable } from './LayoutNode'

/**
 * Options for {@link LayoutRoot}.
 *
 * @category Layout
 */
export interface LayoutRootOptions {
  /**
   * The world rect the content fills. Omit to fill the camera's visible world
   * area (the whole canvas, in world units, adopting its aspect); provide it to
   * pin the content to a fixed region instead of the live camera view.
   */
  bounds?: () => Rect
  /**
   * Camera whose visible area sets the bounds when `bounds` is omitted.
   * Defaults to the camera of the stage this root's scene belongs to.
   */
  camera?: Camera
  /** Node id. Defaults to `layout-root`. */
  id?: string
}

/**
 * Drives a layout subtree so it fills a rect and reflows on resize. Add it to a
 * scene, give it a content node (any {@link Measurable} — a container or a
 * leaf), and the engine measures and arranges that content into the bounds
 * once, then again whenever the window resizes or a descendant calls
 * {@link LayoutNode.markLayoutDirty}.
 *
 * @category Layout
 * @example
 *   const root = new LayoutRoot()
 *   root.setContent(
 *   new Column({
 *   gap: 16,
 *   children: [header, new Expanded({ child: body }), footer],
 *   }),
 *   )
 *   host.engine.scene.root.add(root)
 *
 *   The root finds its engine from the scene when you add it, the way a behavior
 *   does, so there is nothing else to wire up. By default the content fills the
 *   camera's visible world rect and tracks the canvas on resize; pass `bounds` to
 *   pin it to a fixed region instead.
 *
 *   The pass runs after the per-frame update walk and before world-transform
 *   propagation, so arranged positions land the same frame. It is gated on a dirty
 *   flag: quiet frames cost nothing, and an engine with no `LayoutRoot` pays a
 *   single empty-set check per frame.
 */
export class LayoutRoot extends SceneNode {
  readonly #boundsFn?: () => Rect
  readonly #camera?: Camera
  #content: (SceneNode & Measurable) | null = null
  #dirty = true
  readonly #constraints = new BoxConstraints()
  readonly #boundsScratch: Rect = { x: 0, y: 0, width: 0, height: 0 }
  #unregister: (() => void) | null = null
  #offResize: (() => void) | null = null

  constructor(opts: LayoutRootOptions = {}) {
    super(opts.id ?? 'layout-root')
    this.#boundsFn = opts.bounds
    this.#camera = opts.camera
  }

  /**
   * Register with the engine (reached through the scene) and begin reflowing on
   * resize. Runs when the root is added to a scene that belongs to an engine.
   */
  override onAttachedToScene(scene: Scene): void {
    super.onAttachedToScene(scene)
    const engine = scene.engine
    if (!engine || this.#unregister) return
    this.#unregister = engine.registerLayoutRoot(this)
    this.#offResize = engine.events.on('resize', () => this.requestLayout())
    this.requestLayout()
  }

  override onDetachedFromScene(): void {
    this.#offResize?.()
    this.#offResize = null
    this.#unregister?.()
    this.#unregister = null
    super.onDetachedFromScene()
  }

  /**
   * Set the content laid out to fill the bounds. Replaces any previous content
   * (removed from the tree, not destroyed) and schedules a pass. Returns `node`
   * for chaining.
   */
  setContent<T extends SceneNode & Measurable>(node: T): T {
    if (this.#content && this.#content !== node) this.remove(this.#content)
    this.#content = node
    if (node.parent !== this) this.add(node)
    this.requestLayout()
    return node
  }

  /** The current content node, or `null`. */
  get content(): (SceneNode & Measurable) | null {
    return this.#content
  }

  /** Schedule a layout pass on the next frame. */
  requestLayout(): void {
    this.#dirty = true
  }

  /**
   * Internal: run the pass if dirty. Called by the engine each frame between
   * the update walk and transform propagation.
   */
  _runIfDirty(): void {
    if (!this.#dirty || !this.scene) return
    const content = this.#content
    if (!content) {
      this.#dirty = false
      return
    }
    const b = this.#resolveBounds()
    // Clear BEFORE measuring: a markLayoutDirty raised during this pass re-arms
    // the flag for the next frame rather than looping within this one.
    this.#dirty = false
    BoxConstraints.tight(b.width, b.height, this.#constraints)
    const size = content.measure(this.#constraints)
    assertFiniteSize(content, size)
    content.arrange(b.x, b.y, b.width, b.height)
    // Arrange moved nodes via their transforms, which doesn't invalidate the
    // static layer on its own; force invalidation when the subtree has
    // static content so it doesn't draw at the old position.
    if (content.subtreeHasStaticLayer) this.scene.invalidateStatic()
  }

  #resolveBounds(): Rect {
    if (this.#boundsFn) return this.#boundsFn()
    const engine = this.scene?.engine
    const cam =
      this.#camera ??
      engine?.stageForScene(this.scene)?.camera ??
      engine?.camera
    return cam ? cam.visibleWorldRect(this.#boundsScratch) : this.#boundsScratch
  }
}
