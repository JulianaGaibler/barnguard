/**
 * The rendering stack, mostly internal but exposed for advanced use and tests.
 * A {@link Stage} pairs a canvas with a {@link Renderer}, `Scene`, `Camera`, and
 * {@link Layers}, and drives the per-frame draw. Nodes draw through the
 * backend-agnostic {@link Gfx2D} facade, implemented by the WebGL2 backend
 * (default) or {@link Canvas2DGfx} (a parity oracle, opt in with
 * `?renderer=canvas2d`).
 *
 * @module render
 * @category Render
 */
export { Layers } from '../render/Layers'
export { Stage } from '../render/Stage'
export type {
  StageOptions,
  StageResizeInfo,
  StagePointerEvents,
  RendererMode,
} from '../render/Stage'
export { Renderer } from '../render/Renderer'
export type { RendererOptions } from '../render/Renderer'
export type { DynamicResolutionOptions } from '../render/DynamicResolution'
export type {
  Gfx2D,
  GfxBlend,
  GfxStrokeStyle,
  GfxTextStyle,
  GfxGradientStop,
} from '../render/gfx/Gfx2D'
export type { GeometryHandle } from '../render/gfx/GeometryHandle'
export { Canvas2DGfx } from '../render/gfx/Canvas2DGfx'
export type { Canvas2DGfxOptions } from '../render/gfx/Canvas2DGfx'
export { parseColor, mixColor, withAlpha } from '../render/gfx/parseColor'
export type { RGBA } from '../render/gfx/parseColor'
