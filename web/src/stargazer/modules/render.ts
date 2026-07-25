/**
 * The rendering stack, mostly internal but exposed for advanced use and tests.
 * A {@link Stage} pairs a canvas with a {@link Renderer}, `Scene`, and
 * `Camera`, and drives the per-frame draw. Nodes draw through the
 * {@link Gfx2D} facade, implemented by the WebGL2 backend.
 *
 * @module render
 * @category Render
 */
export { Stage } from '../render/Stage'
export type {
  StageOptions,
  StageResizeInfo,
  StagePointerEvents,
} from '../render/Stage'
export { Renderer } from '../render/Renderer'
export type { RendererOptions } from '../render/Renderer'
export type {
  Gfx2D,
  GfxBlend,
  GfxStrokeStyle,
  GfxTextStyle,
  GfxGradientStop,
} from '../render/gfx/Gfx2D'
export { resolveRadii } from '../render/gfx/roundRectRadii'
export type {
  RoundRectRadii,
  ResolvedRadii,
} from '../render/gfx/roundRectRadii'
export type { GeometryHandle } from '../render/gfx/GeometryHandle'
export { parseColor, mixColor, withAlpha } from '../render/gfx/parseColor'
export type { RGBA } from '../render/gfx/parseColor'
