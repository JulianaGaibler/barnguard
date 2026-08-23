/**
 * The rendering stack. A {@link Stage} pairs a canvas with a {@link Renderer}, a
 * `SceneTree`, and cameras, and drives the per-frame draw. Nodes paint through
 * the {@link Gfx2D} facade, which batches into one command list per frame and
 * submits it through a backend seam that WebGPU and WebGL2 both implement
 * ({@link BackendPreference} picks one).
 *
 * Two parts of this module are for everyday game code rather than the renderer.
 * The text helpers ({@link measureText}, {@link wrapText}, {@link ellipsize},
 * {@link fitTextBlock}, {@link richText} and friends) measure and lay out strings
 * ahead of drawing them, and all of them memoize. The post-processing chain
 * ({@link PostProcessPipeline} plus {@link Vignette}, {@link ChromaticAberration},
 * {@link VignetteBlur}) adds screen-space effects and costs nothing until an
 * effect is added.
 *
 * @module render
 */
export type { GfxBackend, ColorFormat } from '../render/gfx/GfxDevice'
export { selectGfxDevice } from '../render/gfx/selectBackend'
export type {
  BackendPreference,
  BackendSelection,
} from '../render/gfx/selectBackend'
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
export { postShader } from '../render/postfx/PostEffect'
export type {
  PostEffect,
  PostPass,
  PostPassContext,
  PostShaderSource,
} from '../render/postfx/PostEffect'
export { ChromaticAberration } from '../render/postfx/effects/ChromaticAberration'
export type { ChromaticAberrationOptions } from '../render/postfx/effects/ChromaticAberration'
export { Vignette } from '../render/postfx/effects/Vignette'
export type { VignetteOptions } from '../render/postfx/effects/Vignette'
export { VignetteBlur } from '../render/postfx/effects/VignetteBlur'
export type { VignetteBlurOptions } from '../render/postfx/effects/VignetteBlur'
export { AmbientOcclusion } from '../render/gfx/ao/AmbientOcclusion'
export type { AoPreset } from '../render/gfx/ao/AmbientOcclusion'
export type {
  Gfx2D,
  GfxBlend,
  GfxClipShape,
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
export {
  clearFontMetricsCache,
  fontMetrics,
  measureText,
} from '../render/gfx/rasterizeLabel'
export { clearTextLayoutCaches } from '../render/gfx/textLayout'
export type {
  FontMetrics,
  LabelStyle,
  LabelMetrics,
} from '../render/gfx/rasterizeLabel'
export {
  ellipsize,
  fitFontSize,
  fitRichTextBlock,
  fitTextBlock,
  richText,
  textAdvance,
  textMetrics,
  textWidth,
  wrapRichText,
  wrapText,
  wrapTextInfo,
} from '../render/gfx/textLayout'
export type {
  InlineBox,
  RichBlock,
  RichBoxRun,
  RichLine,
  RichRun,
  RichTextRun,
  TextBlock,
  TextMeasure,
  TextRun,
  TextSpan,
} from '../render/gfx/textLayout'
