/**
 * Drives HTML elements from scene-node transforms. Attach a DOM element to a
 * {@link Node2D} and the engine writes the element's CSS transform each frame
 * so it stays flush with the canvas: the node's position, scale, rotation, and
 * pivot carry through, and the camera pan/zoom is applied on top. The engine
 * never touches the element's contents, only its box.
 *
 * The element lives in the page, not on the canvas, so it must sit in a
 * container that overlays the canvas exactly (same bounding rect). See the HTML
 * overlays guide.
 */

import type { Engine } from '../engine/Engine'
import type { Node } from '../scene/Node'
import type { Node2D } from '../scene/Node2D'
import type { Node3D } from '../scene/Node3D'
import type { Camera3D, ScreenProjection } from '../camera/Camera3D'
import type { ScreenTransform } from '../camera/Camera'
import { mat4, mat4Identity, mat4Multiply, type Mat4 } from '../math/Mat4'
import { vec3, type Vec3 } from '../math/Vec3'

/**
 * Shared CSS3D layer for `orient` anchors: a plain box positioned over the
 * canvas that oriented elements nest inside. Each element carries the camera's
 * full `viewProjection` baked into its own `matrix3d` (see {@link matrix3dCss}),
 * so the layer needs no CSS `perspective` of its own — the projection, including
 * the ortho<->perspective blend, lives entirely in the per-element matrix and
 * CSS performs the perspective divide from it.
 */
interface Css3dLayer {
  container: HTMLElement
}

/** Round tiny values to 0 so CSS matrix strings stay short and stable. */
function eps(v: number): number {
  return Math.abs(v) < 1e-6 ? 0 : v
}

/** Emit a column-major {@link Mat4} as a CSS `matrix3d(...)` string. */
function matrix3dCss(m: Mat4): string {
  return (
    'matrix3d(' +
    `${eps(m[0])},${eps(m[1])},${eps(m[2])},${eps(m[3])},` +
    `${eps(m[4])},${eps(m[5])},${eps(m[6])},${eps(m[7])},` +
    `${eps(m[8])},${eps(m[9])},${eps(m[10])},${eps(m[11])},` +
    `${eps(m[12])},${eps(m[13])},${eps(m[14])},${eps(m[15])})`
  )
}

/**
 * Viewport matrix mapping clip space (NDC in `[-1, 1]`, y up) to CSS pixels
 * (`[0, cssW] x [0, cssH]`, y down), left-multiplied onto the camera's
 * `viewProjection` so the baked element matrix lands in canvas-pixel space.
 */
function setViewportMatrix(out: Mat4, cssW: number, cssH: number): Mat4 {
  mat4Identity(out)
  out[0] = cssW / 2
  out[5] = -cssH / 2
  out[12] = cssW / 2
  out[13] = cssH / 2
  return out
}

/**
 * Element-local scale mapping CSS pixels on the element's plane to world units:
 * `1 / pxPerUnit`, with y negated because CSS y runs down while world y runs up.
 */
function setElementScaleMatrix(out: Mat4, pxPerUnit: number): Mat4 {
  const s = 1 / pxPerUnit
  mat4Identity(out)
  out[0] = s
  out[5] = -s
  out[10] = s
  return out
}

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
  readonly node: Node2D
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
const scratch3d: ScreenProjection = { x: 0, y: 0, behind: false }
// Orient-mode matrix scratch (sync is synchronous, so sharing is safe).
const scratchViewport: Mat4 = mat4()
const scratchScale: Mat4 = mat4()
const scratchVpM: Mat4 = mat4()
const scratchVpMS: Mat4 = mat4()
const scratchT: Mat4 = mat4()
const scratchEye: Vec3 = vec3()

/**
 * Options for {@link DomTransformSync.attachWorld3d}, pinning an HTML element to
 * a {@link Node3D}.
 *
 * @category DOM
 */
export interface Dom3DAttachOptions {
  /** Hide the element when the node (or an ancestor) is invisible. Default true. */
  syncVisibility?: boolean
  /**
   * Shrink the element with distance from the camera, so it reads as attached to
   * the 3D object rather than floating at a fixed size. Scale is
   * `camera.focalDistance / distance`. Default false. Ignored when `orient` is
   * set (perspective already foreshortens).
   */
  scaleWithDistance?: boolean
  /**
   * Glue the element to the node's surface: inherit its 3D orientation and
   * foreshortening (a tilting, skewing plane) via CSS `matrix3d`, rather than a
   * flat screen-upright label. The element is reparented into an engine-managed
   * layer over the canvas and carries the camera's full `viewProjection`, so it
   * stays flush with the meshes through the whole ortho<->perspective blend
   * (parallel at the orthographic end, foreshortened at the perspective end).
   * No depth occlusion against meshes. Default false.
   */
  orient?: boolean
  /**
   * With `orient`, how many element CSS pixels map to one world unit on the
   * node's plane. Raise it to make the element smaller relative to the scene.
   * Default 200.
   */
  pxPerUnit?: number
  /**
   * With `orient`, hide the element when its front face turns away from the
   * camera (CSS `backface-visibility`). Default true. Set false for a
   * double-sided element visible from both sides.
   */
  backfaceCull?: boolean
}

/**
 * Handle returned by {@link DomTransformSync.attachWorld3d}.
 *
 * @category DOM
 */
export interface Dom3DAttachment {
  readonly node: Node3D
  readonly element: HTMLElement
  setOptions(opts: Dom3DAttachOptions): void
  detach(): void
}

class Attachment implements DomAttachment {
  readonly node: Node2D
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
    node: Node2D,
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
 * Pins an HTML element to a {@link Node3D}'s projected screen position. Projects
 * the node origin through the given {@link Camera3D} each frame and translates
 * the element (centered on the point), hiding it when the node is behind the
 * camera. Position-only: the element stays screen-upright and doesn't inherit 3D
 * rotation. Uses the primary stage's canvas size for the NDC→CSS mapping.
 */
class Attachment3D implements Dom3DAttachment {
  readonly node: Node3D
  readonly element: HTMLElement
  readonly #camera: Camera3D
  #opts: Dom3DAttachOptions
  readonly #onRemove: () => void
  #lastVisible = false
  #lastX = NaN
  #lastY = NaN
  #lastScale = NaN
  #offDestroy: () => void
  #detached = false
  // Orient-mode reparent bookkeeping, so `detach` can put the element back.
  #origParent: HTMLElement | null = null
  #origNext: ChildNode | null = null
  #reparented = false
  #lastCss = ''

  constructor(
    node: Node3D,
    element: HTMLElement,
    camera: Camera3D,
    opts: Dom3DAttachOptions,
    onRemove: () => void,
  ) {
    this.node = node
    this.element = element
    this.#camera = camera
    this.#opts = opts
    this.#onRemove = onRemove
    const s = element.style
    s.position = 'absolute'
    s.left = '0'
    s.top = '0'
    s.margin = '0'
    // Center on the projected point (unlike the 2D top-left anchor).
    s.transformOrigin = '50% 50%'
    s.display = 'none'
    this.#offDestroy = node.events.on('destroy', () => this.detach())
  }

  /** Whether this anchor glues the element to the node's surface via matrix3d. */
  get oriented(): boolean {
    return this.#opts.orient === true
  }

  setOptions(opts: Dom3DAttachOptions): void {
    this.#opts = opts
  }

  detach(): void {
    if (this.#detached) return
    this.#detached = true
    this.#restoreParent()
    this.#offDestroy()
    this.#onRemove()
  }

  #restoreParent(): void {
    if (!this.#reparented) return
    this.#reparented = false
    if (this.#origParent) this.#origParent.insertBefore(this.element, this.#origNext)
  }

  _sync(engine: Engine, layer?: Css3dLayer | null): void {
    if (this.oriented && layer) {
      this.#syncOriented(engine, layer)
      return
    }
    this.#restoreParent()
    this.#syncBillboard(engine)
  }

  /**
   * matrix3d path: nest the element in the canvas-aligned layer and give it the
   * camera's full `viewProjection` baked into a single `matrix3d`, so it lands
   * exactly where the WebGL pass would draw the same plane — in perspective,
   * orthographic, and every blend in between. CSS does the perspective divide
   * from the baked matrix's w-row; at the orthographic end that row is
   * `(0,0,0,1)` so the projection is parallel, matching the meshes.
   */
  #syncOriented(engine: Engine, layer: Css3dLayer): void {
    const node = this.node
    if (this.element.parentElement !== layer.container) {
      this.#origParent = this.element.parentElement
      this.#origNext = this.element.nextSibling
      // Top-left origin: the -50% centering and the matrix work from (0,0).
      this.element.style.transformOrigin = '0 0'
      layer.container.appendChild(this.element)
      this.#reparented = true
    }
    const stage = engine.primaryStage
    const cam = engine.debug?.activeCamera3dFor(stage) ?? stage.camera3d
    const cssW = stage.renderer.cssSize.w
    const cssH = stage.renderer.cssSize.h

    const visible =
      (this.#opts.syncVisibility ?? true) === false ? true : effectiveVisible3d(node)
    node.ensureWorldTransform()
    const w = node.transform.world
    // Behind test: camera-space z of the node origin (camera looks down -z).
    const view = cam.view
    const zCam = view[2] * w[12] + view[6] * w[13] + view[10] * w[14] + view[14]
    let show = visible && zCam < 0 && cssW > 0 && cssH > 0
    // Backface: hide when the element's front (+z of its plane) faces away.
    // "Toward the camera" is the eye point in perspective but the parallel view
    // axis in orthographic, so blend the two by `projectionness` (they share a
    // sign, so the lerp never flips mid-blend). Without this the off-axis eye
    // direction wrongly culls faces the orthographic meshes still show.
    if (show && this.#opts.backfaceCull !== false) {
      const t = cam.projectionness
      // Ortho: camera view axis in world (= view matrix rows 2, unit length).
      const ax = view[2]
      const ay = view[6]
      const az = view[10]
      // Perspective: element -> eye, normalized so the two are comparable.
      const eye = cam.eyePosition(scratchEye)
      const ex = eye.x - w[12]
      const ey = eye.y - w[13]
      const ez = eye.z - w[14]
      const el = Math.hypot(ex, ey, ez) || 1
      const dx = ax * (1 - t) + (ex / el) * t
      const dy = ay * (1 - t) + (ey / el) * t
      const dz = az * (1 - t) + (ez / el) * t
      const facing = w[8] * dx + w[9] * dy + w[10] * dz
      if (facing <= 0) show = false
    }

    if (show !== this.#lastVisible) {
      this.element.style.display = show ? '' : 'none'
      this.#lastVisible = show
    }
    if (!show) return

    // T = viewport · viewProjection · world · scale(1/pxPerUnit): element-local
    // CSS pixels -> canvas pixels, with the projection's perspective divide.
    const vp = setViewportMatrix(scratchViewport, cssW, cssH)
    const scale = setElementScaleMatrix(scratchScale, this.#opts.pxPerUnit ?? 200)
    mat4Multiply(scratchVpM, cam.viewProjection, w)
    mat4Multiply(scratchVpMS, scratchVpM, scale)
    mat4Multiply(scratchT, vp, scratchVpMS)
    // The element is a flat plane (local z = 0), so the matrix's z-axis column
    // never affects where its points land or the perspective divide (which
    // comes from m[3], m[7], m[15]). Reset it to a clean unit z-axis. Under an
    // orthographic projection the baked column becomes near-singular and shears
    // into the screen plane, which makes Firefox drop the element's text
    // (Chrome and Safari still render it); the reset is a no-op for the plane
    // and keeps the matrix well-conditioned so the text renders everywhere.
    scratchT[8] = 0
    scratchT[9] = 0
    scratchT[10] = 1
    scratchT[11] = 0
    // `translate(-50%,-50%)` (applied first) centers the element on the origin.
    const css = `${matrix3dCss(scratchT)} translate(-50%,-50%)`
    if (css !== this.#lastCss) {
      this.#lastCss = css
      this.element.style.transform = css
    }
  }

  /** Screen-upright path: project the node origin, translate the element there. */
  #syncBillboard(engine: Engine): void {
    const stage = engine.primaryStage
    const cssW = stage.renderer.cssSize.w
    const cssH = stage.renderer.cssSize.h
    const node = this.node
    const visible =
      (this.#opts.syncVisibility ?? true) === false ? true : effectiveVisible3d(node)
    let show = visible && cssW > 0 && cssH > 0
    let x = 0
    let y = 0
    let scale = 1
    if (show) {
      node.ensureWorldTransform()
      const w = node.transform.world
      // The node origin is the world matrix's translation column.
      const proj = this.#camera.worldToScreen(w[12], w[13], w[14], cssW, cssH, scratch3d)
      if (proj.behind) {
        show = false
      } else {
        x = proj.x
        y = proj.y
        if (this.#opts.scaleWithDistance) {
          const eye = this.#camera.eyePosition()
          const dist = Math.hypot(w[12] - eye.x, w[13] - eye.y, w[14] - eye.z)
          scale = dist > 1e-4 ? this.#camera.focalDistance / dist : 1
        }
      }
    }

    if (show !== this.#lastVisible) {
      this.element.style.display = show ? '' : 'none'
      this.#lastVisible = show
    }
    if (!show) return

    // Write when any value moved. Phrased as `!(within epsilon)` so the
    // NaN-initialized `#last*` (first frame) also triggers a write.
    if (
      !(
        Math.abs(x - this.#lastX) <= EPSILON &&
        Math.abs(y - this.#lastY) <= EPSILON &&
        Math.abs(scale - this.#lastScale) <= EPSILON
      )
    ) {
      this.#lastX = x
      this.#lastY = y
      this.#lastScale = scale
      const scalePart = this.#opts.scaleWithDistance ? ` scale(${scale})` : ''
      this.element.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)${scalePart}`
    }
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
  readonly #attachments3d = new Set<Attachment3D>()
  #css3d: Css3dLayer | null = null
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
    node: Node2D,
    element: HTMLElement,
    opts: DomAttachOptions = {},
  ): DomAttachment {
    const a: Attachment = new Attachment(node, element, opts, () => {
      this.#attachments.delete(a)
    })
    this.#attachments.add(a)
    return a
  }

  /**
   * Attach `element` to a 3D `node`, projected through `camera` (usually
   * `engine.camera3d`). The element tracks the node's projected screen position
   * each frame and hides when the node is behind the camera. The element must
   * live in a container overlaying the canvas. Detaches automatically if the
   * node is destroyed.
   */
  attachWorld3d(
    node: Node3D,
    element: HTMLElement,
    camera: Camera3D,
    opts: Dom3DAttachOptions = {},
  ): Dom3DAttachment {
    const a: Attachment3D = new Attachment3D(node, element, camera, opts, () => {
      this.#attachments3d.delete(a)
    })
    this.#attachments3d.add(a)
    return a
  }

  /** Detach everything and stop syncing. Called on engine teardown. */
  dispose(): void {
    for (const a of [...this.#attachments]) a.detach()
    for (const a of [...this.#attachments3d]) a.detach()
    this.#css3d?.container.remove()
    this.#css3d = null
    this.#offFrame?.()
    this.#offFrame = null
  }

  #syncAll(): void {
    let anyOriented = false
    for (const a of this.#attachments3d) if (a.oriented) anyOriented = true
    const layer = anyOriented ? this.#updateCss3dLayer() : null
    for (const a of this.#attachments) a._sync(this.#engine)
    for (const a of this.#attachments3d) a._sync(this.#engine, layer)
  }

  /**
   * Ensure the CSS3D layer exists and align it to the canvas's on-screen box.
   * The layer carries no `perspective` of its own: each oriented element bakes
   * the camera's full projection into its own `matrix3d`. Returns the layer for
   * oriented attachments to nest into.
   */
  #updateCss3dLayer(): Css3dLayer {
    const stage = this.#engine.primaryStage
    if (!this.#css3d) {
      const container = document.createElement('div')
      container.style.cssText =
        'position:fixed;pointer-events:none;overflow:hidden;perspective:none'
      document.body.appendChild(container)
      this.#css3d = { container }
    }
    const layer = this.#css3d
    const rect = stage.canvas.getBoundingClientRect()
    const s = layer.container.style
    s.left = `${rect.left}px`
    s.top = `${rect.top}px`
    s.width = `${rect.width}px`
    s.height = `${rect.height}px`
    return layer
  }
}

// Visibility inherits across the whole generic parent chain (a 2D element
// parented under a hidden 3D node disappears, and vice versa), so both walk the
// base `parent`, not the same-kind spatial chain.
function effectiveVisible(node: Node2D): boolean {
  let n: Node | null = node
  while (n) {
    if (!n.visible) return false
    n = n.parent
  }
  return true
}

function effectiveVisible3d(node: Node3D): boolean {
  let n: Node | null = node
  while (n) {
    if (!n.visible) return false
    n = n.parent
  }
  return true
}

// Alpha compounds along the 2D (same-kind) chain only; a 3D ancestor has no 2D
// alpha to contribute.
function effectiveAlpha(node: Node2D): number {
  let alpha = 1
  let n: Node2D | null = node
  while (n) {
    alpha *= n.transform.alpha
    n = n.spatialParent
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
