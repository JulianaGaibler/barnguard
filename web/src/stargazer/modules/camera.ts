/**
 * The world-to-screen view. A {@link Camera} frames a world-space rect and fits
 * it into the canvas at a uniform, aspect-preserving scale. Pan and zoom by
 * setting the viewport or animating it with {@link Camera.animateTo}, and
 * convert coordinates with {@link Camera.worldToScreen} /
 * {@link Camera.screenToWorld}. Each `Stage` owns one.
 *
 * @module camera
 * @category Camera
 */
export { Camera } from '../camera/Camera'
export type { ScreenTransform, CameraAnimateOptions } from '../camera/Camera'
