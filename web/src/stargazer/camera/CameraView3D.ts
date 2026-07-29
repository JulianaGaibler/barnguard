import type { ClipDepth, Mat4 } from '../math/Mat4'
import type { Vec3 } from '../math/Vec3'
import type { Ray } from '../math/Ray'
import type { ScreenProjection, Projectionness } from './Camera3D'

/**
 * The read-only 3D camera surface the render pass, picking, and DOM anchoring
 * consume. Lets a plain `Camera3D` helper, a `CameraNode3D`, or a debug
 * fly-camera stand in interchangeably (the 3D analogue of
 * {@link CameraView2D}).
 *
 * @category Camera
 */
export interface CameraView3D {
  /** View matrix (world → camera). */
  readonly view: Mat4
  /** Projection matrix (ortho↔perspective blend). */
  readonly projection: Mat4
  /** Inverse of {@link CameraView3D.projection} (clip → view). */
  readonly invProjection: Mat4
  /** Combined `projection × view` (world → clip). */
  readonly viewProjection: Mat4
  /** Inverse of {@link CameraView3D.viewProjection} (clip → world). */
  readonly invViewProjection: Mat4

  readonly fovY: number
  readonly near: number
  readonly far: number
  readonly focalDistance: number
  readonly projectionness: Projectionness
  readonly aspect: number

  /** Project a world point to CSS-pixel screen coords. */
  worldToScreen(
    wx: number,
    wy: number,
    wz: number,
    cssW: number,
    cssH: number,
    out?: ScreenProjection,
  ): ScreenProjection
  /** Build a picking ray from a normalized device coordinate. */
  screenToRay(ndcX: number, ndcY: number, out?: Ray): Ray
  /** World-space eye position. */
  eyePosition(out?: Vec3): Vec3
  /** Set the viewport aspect (width / height). */
  setAspect(aspect: number): void
  /**
   * Set the NDC depth convention the projection targets, from the active
   * backend (`device.ndc.clipDepth`). WebGL keeps `[-1,1]`, WebGPU `[0,1]`.
   */
  setClipDepth(clipDepth: ClipDepth): void
}
