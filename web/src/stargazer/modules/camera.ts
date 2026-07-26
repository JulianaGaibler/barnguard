/**
 * The cameras. The 2D {@link Camera} frames a world-space rect and fits it into
 * the canvas at a uniform, aspect-preserving scale (pan/zoom via its viewport or
 * {@link Camera.animateTo}; convert with {@link Camera.worldToScreen} /
 * {@link Camera.screenToWorld}). The 3D {@link Camera3D} is a posed camera whose
 * projection blends continuously between orthographic and perspective
 * ({@link Camera3D.animateProjection}); it feeds the 3D pass and 3D picking
 * ({@link Camera3D.screenToRay}). Each `Stage` owns one of each.
 *
 * @module camera
 * @category Camera
 */
export { Camera } from '../camera/Camera'
export type { ScreenTransform, CameraAnimateOptions } from '../camera/Camera'
export { Camera3D } from '../camera/Camera3D'
export type { Projectionness, ProjectionAnimateOptions } from '../camera/Camera3D'
