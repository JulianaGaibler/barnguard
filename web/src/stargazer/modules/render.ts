/**
 * The rendering stack, mostly internal but exposed for advanced use and tests.
 * A {@link Stage} pairs a canvas with a {@link Renderer}, `Scene`, and `Camera`,
 * and drives the per-frame draw. Nodes draw through the {@link Gfx2D} facade,
 * implemented by the WebGL2 backend.
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
export {
  RenderQuality,
  SHADOW_MAP_SIZES,
  SHADOW_SOFTNESS_TAPS,
} from '../render/RenderQuality'
export type { RenderQualityOptions } from '../render/RenderQuality'
export { Fog } from '../render/Fog'
export type { FogOptions, FogMode } from '../render/Fog'
export { PostProcessPipeline } from '../render/postfx/PostProcessPipeline'
export type {
  PostEffect,
  PostPass,
  PostPassContext,
} from '../render/postfx/PostEffect'
export { ChromaticAberration } from '../render/postfx/effects/ChromaticAberration'
export type { ChromaticAberrationOptions } from '../render/postfx/effects/ChromaticAberration'
export { Vignette } from '../render/postfx/effects/Vignette'
export type { VignetteOptions } from '../render/postfx/effects/Vignette'
export { VignetteBlur } from '../render/postfx/effects/VignetteBlur'
export type { VignetteBlurOptions } from '../render/postfx/effects/VignetteBlur'
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
