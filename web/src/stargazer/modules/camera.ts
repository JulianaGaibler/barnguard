/**
 * The cameras are scene-tree nodes. A {@link CameraNode2D} is transform-first
 * (position / rotation / zoom via its `transform`, parentable) and also frames
 * a world-space rect contain-style ({@link CameraNode2D.setViewport} /
 * {@link CameraNode2D.animateTo}), and the two compose. A {@link CameraNode3D} is
 * a posed 3D camera whose projection blends continuously between orthographic
 * and perspective ({@link CameraNode3D.animateProjection}). It feeds the 3D pass
 * and 3D picking ({@link CameraNode3D.screenToRay}).
 *
 * A `Stage` tracks one _current_ camera per dimension and renders through it.
 * The first camera attached becomes current, and
 * {@link CameraNode2D.makeCurrent} switches. Cameras are never auto-created: add
 * one to the tree and call `makeCurrent()`. A stage with no current camera
 * renders only its clear color. Draw code, input, layout, and DOM anchoring
 * consume the read-only {@link CameraView2D} / {@link CameraView3D} surfaces. The
 * concrete `Camera` / `Camera3D` view-math classes are internal.
 *
 * @module camera
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
