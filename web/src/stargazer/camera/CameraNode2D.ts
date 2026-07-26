import { Node2D } from '../scene/Node2D'
import type { Node } from '../scene/Node'
import type { SceneTree } from '../scene/SceneTree'
import type { Rect } from '../math/Rect'
import type { Vec2 } from '../math/Vec2'
import { Camera, type CameraAnimateOptions } from './Camera'
import type { Affine2x3, CameraView2D } from './CameraView2D'
import type { CameraHost } from './CameraHost'

const DEFAULT_CAMERA_VIEWPORT: Rect = { x: 0, y: 0, width: 1000, height: 1000 }
const EPS = 1e-9

/**
 * A 2D camera as a scene-tree node. It unifies two models:
 *
 * - **Transform camera** (Godot parity): position / rotation /
 *   {@link CameraNode2D.zoom} via the node's `transform`. Parent it under
 *   another node to make the view follow that node.
 * - **Rect framing**: {@link CameraNode2D.setViewport} /
 *   {@link CameraNode2D.animateTo} fit a world rect into the canvas
 *   contain-style, recomputed on resize — the responsive framing kiosk layouts
 *   rely on.
 *
 * The two compose: the framing sets the base fit, the node's world transform is
 * an additional view offset on top (identity by default, so a plain framed
 * camera behaves exactly like the pre-node `Camera`). The effective CSS-pixel
 * world→screen affine is `containFit(framing) ∘ inverse(node.world)`; the
 * renderer folds DPR in on top.
 *
 * A `Stage` tracks one _current_ 2D camera and renders through it. The first
 * camera attached to a stage becomes current; {@link CameraNode2D.makeCurrent}
 * switches, {@link CameraNode2D.enabled} gates.
 *
 * Camera nodes are leaf-only (they reject children) and {@link Node.intrinsic}
 * when auto-created as a stage default.
 *
 * @category Camera
 */
export class CameraNode2D extends Node2D implements CameraView2D {
  /**
   * Internal view-math helper holding the framing rect + contain-fit + pixel
   * size.
   */
  readonly #fit = new Camera(DEFAULT_CAMERA_VIEWPORT)
  #framingEnabled = true

  #enabled = true
  /** Tiebreak for auto pick-next when the current camera detaches; higher wins. */
  priority = 0
  /** `makeCurrent()` called before attach; consumed on first register. */
  #wantsCurrent = false
  // Host captured at attach so detach can unregister — onDetachedFromScene nulls
  // the owner before _onDetach runs, so `this.scene` is gone by then.
  #registeredHost: CameraHost | null = null

  // Bumps whenever this node's world transform changes, so the composed affine
  // cache (which the fit helper's frameNum alone can't detect) re-derives.
  #worldGen = 0
  #cachedFitFrameNum = -1
  #cachedWorldGen = -1
  #degenerate = false

  readonly #screenAffine: Affine2x3 = { a: 0, b: 0, c: 0, d: 0, e: 0, f: 0 }
  readonly #renderAffine: Affine2x3 = { a: 0, b: 0, c: 0, d: 0, e: 0, f: 0 }
  readonly #scratchVec: Vec2 = { x: 0, y: 0 }

  // --- current-camera machinery ---------------------------------------------

  /**
   * Whether this camera can be rendered / picked as current. Disabling the
   * current promotes the next.
   */
  get enabled(): boolean {
    return this.#enabled
  }
  set enabled(v: boolean) {
    if (this.#enabled === v) return
    this.#enabled = v
    if (!v) this.#host()?.reevaluateCurrent2D()
  }

  /** Whether this is the stage's current 2D camera. */
  get isCurrent(): boolean {
    return this.#host()?.isCurrent2D(this) ?? false
  }

  /**
   * Make this the stage's current 2D camera. Before attach, defers via a flag
   * consumed on register.
   */
  makeCurrent(): void {
    const host = this.#host()
    if (host) host.makeCurrent2D(this)
    else this.#wantsCurrent = true
  }

  /** Stop being current; by default the next enabled camera is promoted. */
  clearCurrent(enableNext = true): void {
    this.#wantsCurrent = false
    const host = this.#host()
    if (host && host.isCurrent2D(this) && enableNext) host.reevaluateCurrent2D()
  }

  /** @internal Read by the Stage registry when deciding first-wins. */
  get wantsCurrent(): boolean {
    return this.#wantsCurrent
  }
  /** @internal Cleared by the Stage registry once consumed. */
  consumeWantsCurrent(): void {
    this.#wantsCurrent = false
  }

  #host(): CameraHost | null {
    return (this.scene as SceneTree | null)?.stage ?? null
  }

  // --- framing ---------------------------------------------------------------

  /** World-space rect the camera frames (contain-fit into the canvas). */
  get viewport(): Rect {
    return this.#fit.viewport
  }

  /**
   * Frame `rect` contain-style (re-derives the fit on resize). Enables framing
   * mode.
   */
  setViewport(rect: Rect): void {
    this.#framingEnabled = true
    this.#fit.setViewport(rect)
  }

  /**
   * Drop rect framing and behave as a pure transform camera (position + zoom).
   * The reference is 1 world unit = 1 CSS px with the canvas centered on the
   * camera position; the node transform provides all pan / zoom / rotate.
   */
  clearFraming(): void {
    this.#framingEnabled = false
  }

  /** Whether rect framing is active (vs. pure transform-camera mode). */
  get framingEnabled(): boolean {
    return this.#framingEnabled
  }

  /** Tween the framing viewport (pan-and-zoom). See {@link Camera.animateTo}. */
  animateTo(rect: Rect, opts?: CameraAnimateOptions): Promise<void> {
    this.#framingEnabled = true
    this.#fit.engine = this.engine
    return this.#fit.animateTo(rect, opts)
  }

  /**
   * Zoom scalar (Godot Camera2D parity): larger = closer. A camera's world
   * scale relates inversely to on-screen size — scaling the camera node up
   * shows _more_ world — so `zoom` maps to `1 / transform.scale`.
   */
  get zoom(): number {
    const s = this.transform.scaleX
    return s !== 0 ? 1 / s : 0
  }
  set zoom(z: number) {
    const s = z !== 0 ? 1 / z : 0
    this.transform.scaleX = s
    this.transform.scaleY = s
  }

  // --- render integration ----------------------------------------------------

  /** Stage pushes canvas CSS size here so the framing fit + aspect stay current. */
  setPixelSize(w: number, h: number): void {
    this.#fit.setPixelSize(w, h)
  }

  get frameNum(): number {
    // Monotonic combined key: fit (viewport/pixel) + node world both only
    // increment, so the sum changes on any view change.
    return this.#fit.frameNum + this.#worldGen
  }

  override markWorldDirty(): void {
    this.#worldGen++
    super.markWorldDirty()
  }

  // Recompose `#screenAffine = containFit ∘ inverse(node.world)` if the fit or
  // the node world changed since last time. Sets `#degenerate` on a singular
  // world or a zero fit scale so callers bail instead of emitting NaNs.
  #ensureAffine(): void {
    const fitFN = this.#fit.frameNum
    if (
      this.#cachedFitFrameNum === fitFN &&
      this.#cachedWorldGen === this.#worldGen
    )
      return
    this.#cachedFitFrameNum = fitFN
    this.#cachedWorldGen = this.#worldGen

    this.ensureWorldTransform()
    const w = this.transform.world
    const det = w.a * w.d - w.b * w.c
    const S = this.#screenAffine
    if (Math.abs(det) < EPS) {
      this.#degenerate = true
      S.a = S.b = S.c = S.d = S.e = S.f = 0
      return
    }
    const inv = 1 / det
    // inverse(world), a 2×3 affine
    const Va = w.d * inv
    const Vb = -w.b * inv
    const Vc = -w.c * inv
    const Vd = w.a * inv
    const Ve = (w.c * w.f - w.d * w.e) * inv
    const Vf = (w.b * w.e - w.a * w.f) * inv

    let s: number
    let ox: number
    let oy: number
    if (this.#framingEnabled) {
      const t = this.#fit.getScreenTransform()
      s = t.scale
      ox = t.offsetX
      oy = t.offsetY
    } else {
      // Cleared framing: 1 world unit = 1 CSS px, canvas centered on the camera
      // position (which inverse(world) already resolves to the origin).
      s = 1
      ox = this.#fit.pixelSize.w / 2
      oy = this.#fit.pixelSize.h / 2
    }
    if (!(s > 0)) {
      this.#degenerate = true
      S.a = S.b = S.c = S.d = S.e = S.f = 0
      return
    }
    // S = containFit(scale s, offset o) ∘ inverse(world)
    S.a = s * Va
    S.b = s * Vb
    S.c = s * Vc
    S.d = s * Vd
    S.e = s * Ve + ox
    S.f = s * Vf + oy
    this.#degenerate = !Number.isFinite(S.a + S.b + S.c + S.d + S.e + S.f)
    if (this.#degenerate) S.a = S.b = S.c = S.d = S.e = S.f = 0
  }

  /**
   * True when the composed view affine is singular / non-finite; the renderer
   * skips such a frame.
   */
  get degenerate(): boolean {
    this.#ensureAffine()
    return this.#degenerate
  }

  getScreenAffine(out?: Affine2x3): Affine2x3 {
    this.#ensureAffine()
    const S = this.#screenAffine
    const r = out ?? S
    if (r !== S) {
      r.a = S.a
      r.b = S.b
      r.c = S.c
      r.d = S.d
      r.e = S.e
      r.f = S.f
    }
    return r
  }

  /**
   * The device-pixel base affine `DPR · S` the renderer multiplies onto each
   * node's world. DPR is applied here and ONLY here (screen queries stay in CSS
   * px). Without `out`, returns a cached object; treat it as read-only.
   */
  getRenderAffine(dpr: number, out?: Affine2x3): Affine2x3 {
    this.#ensureAffine()
    const S = this.#screenAffine
    const r = out ?? this.#renderAffine
    r.a = dpr * S.a
    r.b = dpr * S.b
    r.c = dpr * S.c
    r.d = dpr * S.d
    r.e = dpr * S.e
    r.f = dpr * S.f
    return r
  }

  // --- view queries (CameraView2D, all CSS px) -------------------------------

  screenToWorld(x: number, y: number, out?: Vec2): Vec2 {
    this.#ensureAffine()
    const r = out ?? { x: 0, y: 0 }
    const S = this.#screenAffine
    const det = S.a * S.d - S.b * S.c
    if (this.#degenerate || det === 0) {
      r.x = 0
      r.y = 0
      return r
    }
    const inv = 1 / det
    const dx = x - S.e
    const dy = y - S.f
    r.x = (S.d * dx - S.c * dy) * inv
    r.y = (-S.b * dx + S.a * dy) * inv
    return r
  }

  worldToScreen(x: number, y: number, out?: Vec2): Vec2 {
    this.#ensureAffine()
    const r = out ?? { x: 0, y: 0 }
    const S = this.#screenAffine
    r.x = S.a * x + S.c * y + S.e
    r.y = S.b * x + S.d * y + S.f
    return r
  }

  /**
   * Conservative world-space AABB of the full canvas: min/max of all 4 mapped
   * corners.
   */
  visibleWorldRect(out?: Rect): Rect {
    const r = out ?? { x: 0, y: 0, width: 0, height: 0 }
    const pw = this.#fit.pixelSize.w
    const ph = this.#fit.pixelSize.h
    this.#ensureAffine()
    if (this.#degenerate || pw <= 0 || ph <= 0) {
      const v = this.viewport
      r.x = v.x
      r.y = v.y
      r.width = v.width
      r.height = v.height
      return r
    }
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    const corners = [
      [0, 0],
      [pw, 0],
      [0, ph],
      [pw, ph],
    ]
    for (const [cx, cy] of corners) {
      const p = this.screenToWorld(cx, cy, this.#scratchVec)
      if (p.x < minX) minX = p.x
      if (p.x > maxX) maxX = p.x
      if (p.y < minY) minY = p.y
      if (p.y > maxY) maxY = p.y
    }
    r.x = minX
    r.y = minY
    r.width = maxX - minX
    r.height = maxY - minY
    return r
  }

  screenPxPerWorldUnit(): number {
    this.#ensureAffine()
    const S = this.#screenAffine
    return Math.hypot(S.a, S.b)
  }

  strokeSpaceScale(): number {
    const scale = this.screenPxPerWorldUnit()
    return scale > 0 ? 1 / scale : 1
  }

  // --- lifecycle -------------------------------------------------------------

  protected override _onAttach(): void {
    super._onAttach()
    this.#fit.engine = this.engine
    const host = this.#host()
    if (!host) {
      throw new Error(
        `CameraNode2D '${this.id}' was attached to a tree with no camera host ` +
          `(SceneTree.stage is null). Camera nodes must live under a Stage's tree.`,
      )
    }
    this.#registeredHost = host
    host.registerCamera2D(this)
  }

  protected override _onDetach(): void {
    this.#registeredHost?.unregisterCamera2D(this)
    this.#registeredHost = null
    super._onDetach()
  }

  // --- leaf-only -------------------------------------------------------------

  override add(..._children: Node[]): this {
    throw new Error('CameraNode2D is a leaf node and cannot have children')
  }
}
