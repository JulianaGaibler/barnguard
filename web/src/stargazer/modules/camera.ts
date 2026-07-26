/**
 * The cameras — scene-tree nodes (Godot model). A {@link CameraNode2D} is
 * transform-first (position / rotation / zoom via its `transform`, parentable)
 * and also frames a world-space rect contain-style
 * ({@link CameraNode2D.setViewport} / {@link CameraNode2D.animateTo}); the two
 * compose. A {@link CameraNode3D} is a posed 3D camera whose projection blends
 * continuously between orthographic and perspective
 * ({@link CameraNode3D.animateProjection}); it feeds the 3D pass and 3D picking
 * ({@link CameraNode3D.screenToRay}).
 *
 * A `Stage` tracks one _current_ camera per dimension and renders through it;
 * the first camera attached becomes current, {@link CameraNode2D.makeCurrent}
 * switches. Cameras are never auto-created — add one to the tree and
 * `makeCurrent()`; a stage with no current camera renders only its clear color.
 * Draw code, input, layout, and DOM anchoring consume the read-only
 * {@link CameraView2D} / {@link CameraView3D} surfaces; the concrete `Camera` /
 * `Camera3D` view-math classes are internal.
 *
 * @module camera
 * @category Camera
 */
export { CameraNode2D } from '../camera/CameraNode2D'
export { CameraNode3D } from '../camera/CameraNode3D'
export type { CameraView2D, Affine2x3 } from '../camera/CameraView2D'
export type { CameraView3D } from '../camera/CameraView3D'
export type { ScreenTransform, CameraAnimateOptions } from '../camera/Camera'
export type {
  Projectionness,
  ProjectionAnimateOptions,
  ScreenProjection,
} from '../camera/Camera3D'
