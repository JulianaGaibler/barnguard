/**
 * Attach HTML elements to scene nodes. {@link DomTransformSync} (reached as
 * `engine.dom`) writes each attached element's CSS transform every frame so it
 * stays flush with the canvas as the camera pans and zooms; the node's
 * position, scale, rotation, and pivot carry through. {@link projectWorldToCss}
 * is the pure projection behind it. From Svelte, prefer the `domAnchor` action
 * (see the svelte module). See the HTML overlays guide.
 *
 * @module dom
 * @category DOM
 */
export { DomTransformSync, projectWorldToCss } from '../dom/DomTransformSync'
export type {
  DomAttachment,
  DomAttachOptions,
  CssMatrix,
} from '../dom/DomTransformSync'
