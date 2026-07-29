import { Node3D } from '../scene/Node3D'
import type { Node } from '../scene/Node'
import type { SceneTree } from '../scene/SceneTree'
import {
  mat4,
  mat4Invert,
  mat4Multiply,
  mat4TransformPoint,
  type Mat4,
  type ClipDepth,
} from '../math/Mat4'
import { vec3, vec3Normalize, vec3Sub, type Vec3 } from '../math/Vec3'
import type { Ray } from '../math/Ray'
import { clamp } from '../math/scalar'
import {
  Camera3D,
  type Projectionness,
  type ProjectionAnimateOptions,
  type ScreenProjection,
} from './Camera3D'
import type { CameraView3D } from './CameraView3D'
import type { CameraHost } from './CameraHost'

/**
 * A 3D camera as a scene-tree node. Its view is the inverse of the node's world
 * transform, so positioning it via `transform` — or parenting it under another
 * node — drives the camera pose (Godot `Camera3D` parity). Projection (the
 * ortho↔perspective blend) delegates to an internal `Camera3D` helper.
 *
 * A `Stage` tracks one _current_ 3D camera and renders the 3D pass through it.
 * First-attached becomes current; {@link CameraNode3D.makeCurrent} switches,
 * {@link CameraNode3D.enabled} gates. Leaf-only and {@link Node.intrinsic} when
 * auto-created as a stage default.
 *
 * @category Camera
 */
export class CameraNode3D extends Node3D implements CameraView3D {
  /**
   * Internal projection-math helper. Only its projection is used; the view
   * comes from the node world.
   */
  readonly #proj = new Camera3D()

  #enabled = true
  /** Tiebreak for auto pick-next when the current camera detaches; higher wins. */
  priority = 0
  #wantsCurrent = false
  #registeredHost: CameraHost | null = null

  #worldGen = 0
  #projGen = 0
  #cachedWorldGen = -1
  #cachedProjGen = -1
  readonly #view: Mat4 = mat4()
  readonly #viewProj: Mat4 = mat4()
  readonly #invViewProj: Mat4 = mat4()

  // --- projection params (delegate to helper, bump projGen) ------------------

  get fovY(): number {
    return this.#proj.fovY
  }
  set fovY(v: number) {
    this.#proj.fovY = v
    this.#projGen++
  }
  get near(): number {
    return this.#proj.near
  }
  set near(v: number) {
    this.#proj.near = v
    this.#projGen++
  }
  get far(): number {
    return this.#proj.far
  }
  set far(v: number) {
    this.#proj.far = v
    this.#projGen++
  }
  get focalDistance(): number {
    return this.#proj.focalDistance
  }
  set focalDistance(v: number) {
    this.#proj.focalDistance = v
    this.#projGen++
  }
  get projectionness(): Projectionness {
    return this.#proj.projectionness
  }
  set projectionness(t: Projectionness) {
    this.#proj.projectionness = t
    this.#projGen++
  }
  get aspect(): number {
    return this.#proj.aspect
  }
  setClipDepth(clipDepth: ClipDepth): void {
    this.#proj.clipDepth = clipDepth
  }

  setAspect(aspect: number): void {
    this.#proj.setAspect(aspect)
    this.#projGen++
  }

  /**
   * Animate the ortho↔perspective blend. Drives this node's setter so cached
   * matrices refresh.
   */
  async animateProjection(
    target: Projectionness,
    opts: ProjectionAnimateOptions = {},
  ): Promise<void> {
    const engine = this.engine
    if (!engine) {
      throw new Error(
        'CameraNode3D.animateProjection: camera is not attached to an Engine',
      )
    }
    const scratch = { t: this.projectionness }
    await engine.animation.tween(
      scratch,
      { t: clamp(target, 0, 1) },
      {
        duration: opts.duration ?? 0.5,
        delay: opts.delay,
        easing: opts.easing,
        signal: opts.signal,
        onUpdate: () => {
          this.projectionness = scratch.t
        },
      },
    )
    this.projectionness = clamp(target, 0, 1)
  }

  // --- matrices (view from node world, projection from helper) ---------------

  override markWorldDirty(): void {
    this.#worldGen++
    super.markWorldDirty()
  }

  #ensureMatrices(): void {
    if (
      this.#cachedWorldGen === this.#worldGen &&
      this.#cachedProjGen === this.#projGen
    ) {
      return
    }
    this.#cachedWorldGen = this.#worldGen
    this.#cachedProjGen = this.#projGen
    // View = inverse of the node's world pose (world→camera).
    mat4Invert(this.#view, this.worldMatrix)
    mat4Multiply(this.#viewProj, this.#proj.projection, this.#view)
    mat4Invert(this.#invViewProj, this.#viewProj)
  }

  /** Projection matrix (ortho↔perspective blend). */
  get projection(): Mat4 {
    return this.#proj.projection
  }

  /** Inverse of {@link CameraNode3D.projection} (clip → view). */
  get invProjection(): Mat4 {
    // Projection is view-independent, so it delegates straight to the helper.
    return this.#proj.invProjection
  }

  /** View matrix (inverse of the node's world pose). */
  get view(): Mat4 {
    this.#ensureMatrices()
    return this.#view
  }

  /** Combined `projection × view` (world → clip). */
  get viewProjection(): Mat4 {
    this.#ensureMatrices()
    return this.#viewProj
  }

  /** Inverse of {@link CameraNode3D.viewProjection} (clip → world). */
  get invViewProjection(): Mat4 {
    this.#ensureMatrices()
    return this.#invViewProj
  }

  /**
   * Project a world point to CSS-pixel screen coords. See
   * `Camera3D.worldToScreen`.
   */
  worldToScreen(
    wx: number,
    wy: number,
    wz: number,
    cssW: number,
    cssH: number,
    out?: ScreenProjection,
  ): ScreenProjection {
    this.#ensureMatrices()
    const m = this.#viewProj
    const clipX = m[0] * wx + m[4] * wy + m[8] * wz + m[12]
    const clipY = m[1] * wx + m[5] * wy + m[9] * wz + m[13]
    const clipW = m[3] * wx + m[7] * wy + m[11] * wz + m[15]
    const r: ScreenProjection = out ?? { x: 0, y: 0, behind: false }
    if (clipW <= 1e-6) {
      r.behind = true
      r.x = 0
      r.y = 0
      return r
    }
    const inv = 1 / clipW
    r.behind = false
    r.x = ((clipX * inv + 1) * cssW) / 2
    r.y = ((1 - clipY * inv) * cssH) / 2
    return r
  }

  /**
   * Build a picking ray from a normalized device coordinate. See
   * `Camera3D.screenToRay`.
   */
  screenToRay(ndcX: number, ndcY: number, out?: Ray): Ray {
    this.#ensureMatrices()
    const near = mat4TransformPoint(vec3(), this.#invViewProj, ndcX, ndcY, -1)
    const far = mat4TransformPoint(vec3(), this.#invViewProj, ndcX, ndcY, 1)
    const r: Ray = out ?? { origin: vec3(), direction: vec3() }
    r.origin.x = near.x
    r.origin.y = near.y
    r.origin.z = near.z
    vec3Normalize(r.direction, vec3Sub(r.direction, far, near))
    return r
  }

  /** World-space eye position (node world translation). */
  eyePosition(out?: Vec3): Vec3 {
    const m = this.worldMatrix
    const r = out ?? vec3()
    r.x = m[12]
    r.y = m[13]
    r.z = m[14]
    return r
  }

  // --- current-camera machinery ---------------------------------------------

  get enabled(): boolean {
    return this.#enabled
  }
  set enabled(v: boolean) {
    if (this.#enabled === v) return
    this.#enabled = v
    if (!v) this.#host()?.reevaluateCurrent3D()
  }

  get isCurrent(): boolean {
    return this.#host()?.isCurrent3D(this) ?? false
  }

  makeCurrent(): void {
    const host = this.#host()
    if (host) host.makeCurrent3D(this)
    else this.#wantsCurrent = true
  }

  clearCurrent(enableNext = true): void {
    this.#wantsCurrent = false
    const host = this.#host()
    if (host && host.isCurrent3D(this) && enableNext) host.reevaluateCurrent3D()
  }

  /** @internal */
  get wantsCurrent(): boolean {
    return this.#wantsCurrent
  }
  /** @internal */
  consumeWantsCurrent(): void {
    this.#wantsCurrent = false
  }

  #host(): CameraHost | null {
    return (this.owner as SceneTree | null)?.stage ?? null
  }

  // --- lifecycle -------------------------------------------------------------

  protected override _onAttach(): void {
    const host = this.#host()
    if (!host) {
      throw new Error(
        `CameraNode3D '${this.id}' was attached to a tree with no camera host ` +
          `(SceneTree.stage is null). Camera nodes must live under a Stage's tree.`,
      )
    }
    this.#registeredHost = host
    host.registerCamera3D(this)
  }

  protected override _onDetach(): void {
    this.#registeredHost?.unregisterCamera3D(this)
    this.#registeredHost = null
  }

  // --- leaf-only -------------------------------------------------------------

  override add(..._children: Node[]): this {
    throw new Error('CameraNode3D is a leaf node and cannot have children')
  }
}
