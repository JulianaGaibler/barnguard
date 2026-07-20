/**
 * Drives HTML elements from scene-node transforms. Attach a DOM element to a
 * {@link SceneNode} and the engine writes the element's CSS transform each frame
 * so it stays flush with the canvas: the node's position, scale, rotation, and
 * pivot carry through, and the camera pan/zoom is applied on top. The engine
 * never touches the element's contents, only its box.
 *
 * The element lives in the page, not on the canvas, so it must sit in a
 * container that overlays the canvas exactly (same bounding rect). See the HTML
 * overlays guide.
 */

import type { Engine } from '../engine/Engine'
import type { SceneNode } from '../scene/SceneNode'
import type { ScreenTransform } from '../camera/Camera'

/** A 2D affine as the six CSS `matrix()` components. */
export interface CssMatrix {
  a: number
  b: number
  c: number
  d: number
  e: number
  f: number
}

/**
 * Compose a camera screen transform after a node's world affine into the CSS
 * `matrix(a,b,c,d,e,f)` that places a DOM element over the same region the
 * canvas draws the node. The screen transform is uniform scale plus translate
 * in CSS pixels (`Camera.getScreenTransform`); the node's world affine carries
 * any rotation, scale, and the baked-in pivot. Writes into `out` (no
 * allocation) and returns it.
 *
 * @category DOM
 * @example
 *   const m = projectWorldToCss(
 *     camera.getScreenTransform(),
 *     node.transform.world,
 *   )
 *   el.style.transform = `matrix(${m.a},${m.b},${m.c},${m.d},${m.e},${m.f})`
 */
export function projectWorldToCss(
  screen: ScreenTransform,
  world: CssMatrix,
  out: CssMatrix = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
): CssMatrix {
  const s = screen.scale
  out.a = s * world.a
  out.b = s * world.b
  out.c = s * world.c
  out.d = s * world.d
  out.e = s * world.e + screen.offsetX
  out.f = s * world.f + screen.offsetY
  return out
}

/**
 * Options for {@link DomTransformSync.attach}.
 *
 * @category DOM
 */
export interface DomAttachOptions {
  /**
   * World-space size of the node's rect. When set, the element's width/height
   * are pinned to it (in CSS pixels, before the transform scales them), so the
   * element exactly overlays that rect. Omit to leave the element sizing itself
   * and only anchor its origin.
   */
  size?: { width: number; height: number }
  /**
   * Hide the element (via `display:none`) when the node or any ancestor is not
   * visible. Default true.
   */
  syncVisibility?: boolean
  /**
   * Mirror the node's effective (ancestor-compounded) `transform.alpha` onto
   * the element's opacity. Default false, so it never fights an external fade.
   */
  syncOpacity?: boolean
  /**
   * Hide the element (via `display:none`) once its rect leaves the canvas.
   * Needs `size` to know the rect (falls back to the node's origin point). Lets
   * a panel ride the camera off-screen and drop out of layout and hit-testing
   * without any orchestration. Default false.
   */
  cull?: boolean
}

/**
 * Handle returned by {@link DomTransformSync.attach}. Keep it to change options
 * or to detach.
 *
 * @category DOM
 */
export interface DomAttachment {
  readonly node: SceneNode
  readonly element: HTMLElement
  /** Replace the attachment's options (e.g. a new `size`). */
  setOptions(opts: DomAttachOptions): void
  /** Stop syncing and release the element (its styles are left as last written). */
  detach(): void
}

const EPSILON = 1e-5

// One scratch matrix reused across all attachments; syncing is synchronous, so
// there's no reentrancy.
const scratch: CssMatrix = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }

class Attachment implements DomAttachment {
  readonly node: SceneNode
  readonly element: HTMLElement
  #opts: DomAttachOptions
  readonly #onRemove: () => void
  readonly #last: CssMatrix = { a: NaN, b: NaN, c: NaN, d: NaN, e: NaN, f: NaN }
  // Starts hidden so the element never shows unpositioned for the frame between
  // attach and the first sync; the first sync reveals it once placed.
  #lastVisible = false
  #lastOpacity = NaN
  #lastWidth = NaN
  #lastHeight = NaN
  #offDestroy: () => void
  #detached = false

  constructor(
    node: SceneNode,
    element: HTMLElement,
    opts: DomAttachOptions,
    onRemove: () => void,
  ) {
    this.#onRemove = onRemove
    this.node = node
    this.element = element
    this.#opts = opts
    const s = element.style
    s.position = 'absolute'
    s.left = '0'
    s.top = '0'
    s.margin = '0'
    s.transformOrigin = '0 0'
    s.display = 'none'
    this.#applySize()
    // Auto-detach if the node is destroyed while still attached.
    this.#offDestroy = node.events.on('destroy', () => this.detach())
  }

  setOptions(opts: DomAttachOptions): void {
    this.#opts = opts
    this.#applySize()
  }

  detach(): void {
    if (this.#detached) return
    this.#detached = true
    this.#offDestroy()
    this.#onRemove()
  }

  #applySize(): void {
    const size = this.#opts.size
    const w = size ? size.width : NaN
    const h = size ? size.height : NaN
    if (w !== this.#lastWidth) {
      this.element.style.width = size ? `${w}px` : ''
      this.#lastWidth = w
    }
    if (h !== this.#lastHeight) {
      this.element.style.height = size ? `${h}px` : ''
      this.#lastHeight = h
    }
  }

  /** Called by the manager each frame. */
  _sync(engine: Engine): void {
    const node = this.node
    // Fall back to the primary stage so there's always a camera and canvas size.
    const stage = engine.stageForScene(node.scene) ?? engine.primaryStage
    const cam = engine.debug?.activeCameraFor(stage) ?? stage.camera
    const screen = cam.getScreenTransform()

    const visible =
      (this.#opts.syncVisibility ?? true) === false
        ? true
        : effectiveVisible(node)
    // A zero scale means the canvas is mid-resize with no valid mapping; hide
    // rather than place the element wrongly for a frame.
    let show = visible && screen.scale > 0
    if (show) {
      // Project first: the cull test reads the resulting matrix.
      node.ensureWorldTransform()
      projectWorldToCss(screen, node.transform.world, scratch)
      if (this.#opts.cull && this.#offCanvas(stage)) show = false
    }

    if (show !== this.#lastVisible) {
      this.element.style.display = show ? '' : 'none'
      this.#lastVisible = show
    }
    if (!show) return

    if (!matrixClose(scratch, this.#last)) {
      copyMatrix(scratch, this.#last)
      this.element.style.transform = `matrix(${scratch.a}, ${scratch.b}, ${scratch.c}, ${scratch.d}, ${scratch.e}, ${scratch.f})`
    }

    if (this.#opts.syncOpacity) {
      const alpha = effectiveAlpha(node)
      if (Math.abs(alpha - this.#lastOpacity) > EPSILON) {
        this.element.style.opacity = String(alpha)
        this.#lastOpacity = alpha
      }
    }
  }

  /**
   * True when the node's rect (from `scratch`, the current screen matrix, and
   * `size`) lies fully outside the canvas. With no `size`, tests the origin.
   */
  #offCanvas(stage: Engine['primaryStage']): boolean {
    const cw = stage.renderer.cssSize.w
    const ch = stage.renderer.cssSize.h
    if (cw <= 0 || ch <= 0) return false
    const m = scratch
    const size = this.#opts.size
    if (!size) {
      return m.e < 0 || m.e > cw || m.f < 0 || m.f > ch
    }
    const w = size.width
    const h = size.height
    // The four rect corners mapped to screen (local coords are world units).
    const x0 = m.e
    const x1 = m.a * w + m.e
    const x2 = m.c * h + m.e
    const x3 = m.a * w + m.c * h + m.e
    const y0 = m.f
    const y1 = m.b * w + m.f
    const y2 = m.d * h + m.f
    const y3 = m.b * w + m.d * h + m.f
    const minX = Math.min(x0, x1, x2, x3)
    const maxX = Math.max(x0, x1, x2, x3)
    const minY = Math.min(y0, y1, y2, y3)
    const maxY = Math.max(y0, y1, y2, y3)
    return maxX <= 0 || minX >= cw || maxY <= 0 || minY >= ch
  }
}

/**
 * Per-engine manager that syncs every attached DOM element once per frame.
 * Reachable as {@link Engine.dom}; you rarely construct it directly. Attach with
 * {@link DomTransformSync.attach} (or the `domAnchor` Svelte action).
 *
 * @category DOM
 * @example
 *   const handle = engine.dom.attach(node, panelEl, {
 *     size: { width: 480, height: 320 },
 *   })
 *   // ...later
 *   handle.detach()
 */
export class DomTransformSync {
  readonly #engine: Engine
  readonly #attachments = new Set<Attachment>()
  #offFrame: (() => void) | null

  constructor(engine: Engine) {
    this.#engine = engine
    // Fires after render, still inside the rAF tick, so the CSS transform and
    // the canvas composite together on the same visual frame.
    this.#offFrame = engine.events.on('frame', () => this.#syncAll())
  }

  /**
   * Attach `element` to `node`. The element must live in a container that
   * overlays the canvas exactly; this only writes its transform. Returns a
   * handle for changing options or detaching. Detaches automatically if the
   * node is destroyed.
   */
  attach(
    node: SceneNode,
    element: HTMLElement,
    opts: DomAttachOptions = {},
  ): DomAttachment {
    const a: Attachment = new Attachment(node, element, opts, () => {
      this.#attachments.delete(a)
    })
    this.#attachments.add(a)
    return a
  }

  /** Detach everything and stop syncing. Called on engine teardown. */
  dispose(): void {
    for (const a of [...this.#attachments]) a.detach()
    this.#offFrame?.()
    this.#offFrame = null
  }

  #syncAll(): void {
    for (const a of this.#attachments) a._sync(this.#engine)
  }
}

function effectiveVisible(node: SceneNode): boolean {
  let n: SceneNode | null = node
  while (n) {
    if (!n.visible) return false
    n = n.parent
  }
  return true
}

function effectiveAlpha(node: SceneNode): number {
  let alpha = 1
  let n: SceneNode | null = node
  while (n) {
    alpha *= n.transform.alpha
    n = n.parent
  }
  return alpha
}

function matrixClose(m: CssMatrix, ref: CssMatrix): boolean {
  return (
    Math.abs(m.a - ref.a) <= EPSILON &&
    Math.abs(m.b - ref.b) <= EPSILON &&
    Math.abs(m.c - ref.c) <= EPSILON &&
    Math.abs(m.d - ref.d) <= EPSILON &&
    Math.abs(m.e - ref.e) <= EPSILON &&
    Math.abs(m.f - ref.f) <= EPSILON
  )
}

function copyMatrix(from: CssMatrix, to: CssMatrix): void {
  to.a = from.a
  to.b = from.b
  to.c = from.c
  to.d = from.d
  to.e = from.e
  to.f = from.f
}
