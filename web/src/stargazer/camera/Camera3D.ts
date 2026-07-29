import {
  mat4,
  mat4Copy,
  mat4Multiply,
  mat4Invert,
  mat4Perspective,
  mat4Ortho,
  mat4TransformPoint,
  type Mat4,
  type ClipDepth,
} from '../math/Mat4'
import { Transform3D } from '../math/Transform3D'
import { vec3, vec3Normalize, vec3Sub, type Vec3 } from '../math/Vec3'
import type { Ray } from '../math/Ray'
import { clamp, lerp } from '../math/scalar'
import type { Engine } from '../engine/Engine'
import type { Easing } from '../math/easings'
import type { CameraView3D } from './CameraView3D'

/**
 * Projection blend between orthographic (`0`) and perspective (`1`). A
 * `Camera3D` animates this value to move between the two looks; see
 * {@link CameraNode3D.animateProjection}.
 *
 * @category Camera
 */
export type Projectionness = number

/**
 * Result of {@link CameraNode3D.worldToScreen}: CSS-pixel position plus a
 * `behind`-camera flag (position invalid when true).
 *
 * @category Camera
 */
export interface ScreenProjection {
  x: number
  y: number
  behind: boolean
}

/**
 * Options for {@link CameraNode3D.animateProjection}.
 *
 * @category Camera
 */
export interface ProjectionAnimateOptions {
  /** Total duration in seconds. Default 0.5. */
  duration?: number
  /** Seconds to wait before advancing. */
  delay?: number
  easing?: Easing
  signal?: AbortSignal
}

const DEG2RAD = Math.PI / 180

/**
 * A camera in the 3D world: a {@link Transform3D} pose plus a projection that
 * blends continuously between orthographic and perspective. The 3D render pass
 * reads {@link Camera3D.viewProjection} each frame; picking reads
 * {@link Camera3D.screenToRay}.
 *
 * The projection is described by parameters (vertical field of view, near/far,
 * and a `focalDistance`), not by two fixed matrices. Blending them and
 * rebuilding the matrix keeps intermediate states valid, and anchoring the
 * orthographic size to the perspective frustum at `focalDistance` keeps an
 * object at that depth the same on-screen size across the whole transition.
 *
 * The world is right-handed, y-up, with the camera looking down its local `-z`.
 *
 * Internal projection-math helper. A `CameraNode3D` owns one of these and
 * drives its view from the node's world pose; the debug HUD swaps in its own to
 * inspect the scene. Not part of the public API.
 *
 * @category Camera
 * @internal
 */
export class Camera3D implements CameraView3D {
  /** Camera pose. Position + orientation of the eye in the world. */
  readonly transform = new Transform3D()

  /**
   * Set by the owning `Engine`/`Stage` after construction. `null` when used
   * standalone (unit tests). Only {@link Camera3D.animateProjection} needs it.
   */
  engine: Engine | null = null

  #_fovYDeg = 50
  #_near = 0.1
  #_far = 1000
  #_aspect = 1
  #_focalDistance = 8
  #_projectionness: Projectionness = 1
  #_clipDepth: ClipDepth = 'neg-one-to-one'

  #_projDirty = true
  #_viewDirty = true
  readonly #_proj: Mat4 = mat4()
  readonly #_invProj: Mat4 = mat4()
  #_invProjDirty = true
  readonly #_view: Mat4 = mat4()
  readonly #_viewProj: Mat4 = mat4()
  readonly #_invViewProj: Mat4 = mat4()
  #_viewProjDirty = true

  constructor() {
    this.transform.onDirty = () => {
      this.#_viewDirty = true
      this.#_viewProjDirty = true
    }
  }

  /** Vertical field of view in degrees (perspective end of the blend). */
  get fovY(): number {
    return this.#_fovYDeg
  }
  set fovY(deg: number) {
    if (this.#_fovYDeg === deg) return
    this.#_fovYDeg = deg
    this.#markProjDirty()
  }

  /** Near clip distance. */
  get near(): number {
    return this.#_near
  }
  set near(v: number) {
    if (this.#_near === v) return
    this.#_near = v
    this.#markProjDirty()
  }

  /** Far clip distance. */
  get far(): number {
    return this.#_far
  }
  set far(v: number) {
    if (this.#_far === v) return
    this.#_far = v
    this.#markProjDirty()
  }

  /**
   * Viewport aspect ratio (width / height). Kept in sync by the stage on
   * resize.
   */
  get aspect(): number {
    return this.#_aspect
  }
  setAspect(aspect: number): void {
    if (aspect <= 0 || this.#_aspect === aspect) return
    this.#_aspect = aspect
    this.#markProjDirty()
  }

  setClipDepth(clipDepth: ClipDepth): void {
    this.clipDepth = clipDepth
  }

  /**
   * Depth at which the orthographic and perspective projections match in scale.
   * An object at this distance keeps its on-screen size across a projection
   * blend, so the transition doesn't appear to zoom.
   */
  get focalDistance(): number {
    return this.#_focalDistance
  }
  set focalDistance(v: number) {
    const d = v > 0 ? v : 1
    if (this.#_focalDistance === d) return
    this.#_focalDistance = d
    this.#markProjDirty()
  }

  /** Current ortho<->perspective blend in `[0, 1]`. */
  get projectionness(): Projectionness {
    return this.#_projectionness
  }
  set projectionness(t: Projectionness) {
    const c = clamp(t, 0, 1)
    if (this.#_projectionness === c) return
    this.#_projectionness = c
    this.#markProjDirty()
  }

  /**
   * NDC depth convention the projection is built for. Set from the active
   * backend (`device.ndc.clipDepth`) so the uploaded view-projection lands
   * depth in the range the backend keeps, and `screenToRay` unprojects the near
   * plane at the matching z. Rebuilding on a change keeps picking consistent
   * with the render projection.
   */
  get clipDepth(): ClipDepth {
    return this.#_clipDepth
  }
  set clipDepth(v: ClipDepth) {
    if (this.#_clipDepth === v) return
    this.#_clipDepth = v
    this.#markProjDirty()
  }

  #markProjDirty(): void {
    this.#_projDirty = true
    this.#_invProjDirty = true
    this.#_viewProjDirty = true
  }

  /**
   * Projection matrix for the current parameters. Orthographic and perspective
   * matrices are built from the shared vertical extent at `focalDistance` and
   * blended by `projectionness`, so an object at that depth holds its size.
   */
  get projection(): Mat4 {
    if (this.#_projDirty) {
      const fov = this.#_fovYDeg * DEG2RAD
      // Half-height of the view volume at the focal plane. Both projections use
      // it, so they agree on scale at that depth.
      const halfH = Math.tan(fov / 2) * this.#_focalDistance
      const halfW = halfH * this.#_aspect
      const persp = mat4Perspective(
        mat4(),
        fov,
        this.#_aspect,
        this.#_near,
        this.#_far,
        this.#_clipDepth,
      )
      const ortho = mat4Ortho(
        mat4(),
        -halfW,
        halfW,
        -halfH,
        halfH,
        this.#_near,
        this.#_far,
        this.#_clipDepth,
      )
      const t = this.#_projectionness
      if (t <= 0) {
        mat4Copy(this.#_proj, ortho)
      } else if (t >= 1) {
        mat4Copy(this.#_proj, persp)
      } else {
        for (let i = 0; i < 16; i++)
          this.#_proj[i] = lerp(ortho[i], persp[i], t)
      }
      this.#_projDirty = false
    }
    return this.#_proj
  }

  /**
   * Inverse of {@link Camera3D.projection} (clip → view). Reconstructs a
   * view-space position from a sampled depth (the AO pass), and stays correct
   * across the ortho↔perspective blend because it inverts the actual blended
   * projection, not a hardcoded perspective form.
   */
  get invProjection(): Mat4 {
    if (this.#_invProjDirty) {
      mat4Invert(this.#_invProj, this.projection)
      this.#_invProjDirty = false
    }
    return this.#_invProj
  }

  /** View matrix (inverse of the camera pose). */
  get view(): Mat4 {
    if (this.#_viewDirty) {
      this.transform.updateLocal()
      // The pose is camera→world; the view is its inverse (world→camera).
      mat4Invert(this.#_view, this.transform.local)
      this.#_viewDirty = false
    }
    return this.#_view
  }

  /** Combined `projection × view` (world → clip). Rebuilt lazily. */
  get viewProjection(): Mat4 {
    if (this.#_viewProjDirty) {
      mat4Multiply(this.#_viewProj, this.projection, this.view)
      mat4Invert(this.#_invViewProj, this.#_viewProj)
      this.#_viewProjDirty = false
    }
    return this.#_viewProj
  }

  /** Inverse of {@link Camera3D.viewProjection} (clip → world), for unprojecting. */
  get invViewProjection(): Mat4 {
    void this.viewProjection // ensure current
    return this.#_invViewProj
  }

  /**
   * Project a world point to CSS-pixel screen coords in a `cssW`×`cssH` canvas.
   * `behind` is true when the point is at or behind the camera plane (clip `w
   * <= 0`), in which case `x`/`y` are meaningless and the caller should hide
   * whatever it's positioning. Used by the DOM 3D anchor and debug labels.
   */
  worldToScreen(
    wx: number,
    wy: number,
    wz: number,
    cssW: number,
    cssH: number,
    out?: ScreenProjection,
  ): ScreenProjection {
    const m = this.viewProjection
    // Clip-space components; keep `w` (mat4TransformPoint discards it, so the
    // behind-camera test needs the raw value before the perspective divide).
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
   * Build a picking ray from a normalized device coordinate (`ndcX`/`ndcY` in
   * `[-1, 1]`, y up). Unprojects the near and far plane points and returns the
   * ray from the near point along their difference. Pass the result to a node's
   * `hitTest`.
   */
  screenToRay(ndcX: number, ndcY: number, out?: Ray): Ray {
    // Touch the getter so `#_invViewProj` is current.
    void this.viewProjection
    // Near-plane NDC z matches the clip-depth convention (0 for [0,1], -1 for
    // [-1,1]); the far plane is z = 1 in both.
    const nearZ = this.#_clipDepth === 'zero-to-one' ? 0 : -1
    const near = mat4TransformPoint(
      vec3(),
      this.#_invViewProj,
      ndcX,
      ndcY,
      nearZ,
    )
    const far = mat4TransformPoint(vec3(), this.#_invViewProj, ndcX, ndcY, 1)
    const r: Ray = out ?? { origin: vec3(), direction: vec3() }
    r.origin.x = near.x
    r.origin.y = near.y
    r.origin.z = near.z
    vec3Normalize(r.direction, vec3Sub(r.direction, far, near))
    return r
  }

  /** World-space eye position (camera pose translation). */
  eyePosition(out?: Vec3): Vec3 {
    this.transform.updateLocal()
    const m = this.transform.local
    const r = out ?? vec3()
    r.x = m[12]
    r.y = m[13]
    r.z = m[14]
    return r
  }

  /**
   * Animate {@link Camera3D.projectionness} to `target` (0 = ortho, 1 =
   * perspective) through the engine's `Animator`. Resolves when the tween
   * settles, rejects with `AbortError` on `opts.signal`. Requires an attached
   * engine.
   */
  async animateProjection(
    target: Projectionness,
    opts: ProjectionAnimateOptions = {},
  ): Promise<void> {
    const engine = this.engine
    if (!engine) {
      throw new Error(
        'Camera3D.animateProjection: camera is not attached to an Engine',
      )
    }
    const scratch = { t: this.#_projectionness }
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
}
