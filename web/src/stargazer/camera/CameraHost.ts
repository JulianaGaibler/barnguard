import type { CameraNode2D } from './CameraNode2D'
import type { CameraNode3D } from './CameraNode3D'

/**
 * The per-stage camera registry a camera node talks to. A `Stage` implements
 * this and exposes itself through {@link SceneTree.stage}, so camera nodes
 * attached under the tree can register themselves, become the current camera,
 * and query current-ness — Godot's `Viewport` current-camera model.
 *
 * @category Camera
 */
export interface CameraHost {
  /**
   * Called from a `CameraNode2D`'s attach; first registered (or one wanting
   * current) becomes current.
   */
  registerCamera2D(cam: CameraNode2D): void
  /**
   * Called from detach; if `cam` was current, the next enabled camera is
   * promoted.
   */
  unregisterCamera2D(cam: CameraNode2D): void
  /** Make `cam` the current 2D camera now. */
  makeCurrent2D(cam: CameraNode2D): void
  /** Whether `cam` is the current 2D camera. */
  isCurrent2D(cam: CameraNode2D): boolean
  /**
   * Re-pick the current 2D camera if the current one is no longer eligible
   * (e.g. disabled).
   */
  reevaluateCurrent2D(): void

  registerCamera3D(cam: CameraNode3D): void
  unregisterCamera3D(cam: CameraNode3D): void
  makeCurrent3D(cam: CameraNode3D): void
  isCurrent3D(cam: CameraNode3D): boolean
  reevaluateCurrent3D(): void
}
