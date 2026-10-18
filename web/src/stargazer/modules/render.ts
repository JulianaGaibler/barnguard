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
 * {@link VignetteBlur}, {@link DualKawaseBlur}, {@link FilmGrain}) adds
 * screen-space effects and costs nothing until an effect is added.
 *
 * @module render
 */
export type {
  GfxBackend,
  ColorFormat,
  ShaderReflection,
} from '../render/gfx/GfxDevice'
export { selectGfxDevice } from '../render/gfx/selectBackend'
export type {
  BackendPreference,
  BackendSelection,
} from '../render/gfx/selectBackend'
export { Stage } from '../render/Stage'
export type {
  StageOptions,
  StagePixelSize,
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
export {
  QualityControl,
  QUALITY_PRESETS,
  type ManualQuality,
  type QualityHost,
  type QualityMode,
  type QualityPreset,
  type QualityPresetId,
} from '../render/QualityControl'
export {
  QUALITY_GROUPS,
  type QualityGroup,
  type QualityValues,
} from '../render/qualityGroups'
export { Fog } from '../render/Fog'
export type { FogOptions, FogMode } from '../render/Fog'
export { PostProcessPipeline } from '../render/postfx/PostProcessPipeline'
export { isDataPass, postShader } from '../render/postfx/PostEffect'
export type {
  PostDataInput,
  PostDataPass,
  PostEffect,
  PostPass,
  PostPassContext,
  PostPassTexture,
  PostPlacement,
  PostSourceInfo,
  PostStep,
  PostShaderSource,
} from '../render/postfx/PostEffect'
export { ChromaticAberration } from '../render/postfx/effects/ChromaticAberration'
export type { ChromaticAberrationOptions } from '../render/postfx/effects/ChromaticAberration'
export { Vignette } from '../render/postfx/effects/Vignette'
export type { VignetteOptions } from '../render/postfx/effects/Vignette'
export { VignetteBlur } from '../render/postfx/effects/VignetteBlur'
export type { VignetteBlurOptions } from '../render/postfx/effects/VignetteBlur'
export { DualKawaseBlur } from '../render/postfx/effects/DualKawaseBlur'
export type { DualKawaseBlurOptions } from '../render/postfx/effects/DualKawaseBlur'
export { FilmGrain } from '../render/postfx/effects/FilmGrain'
export type { FilmGrainOptions } from '../render/postfx/effects/FilmGrain'
export { AmbientOcclusion } from '../render/gfx/ao/AmbientOcclusion'
export type { AoPreset, AoResolution } from '../render/gfx/ao/AmbientOcclusion'
export type {
  Gfx2D,
  GfxBlend,
  GfxClipShape,
  GfxStrokeStyle,
  GfxTextStyle,
  GfxGradientStop,
  GfxImageOptions,
  GfxMatteMode,
  GfxOffscreenHandle,
  GfxOffscreenOptions,
  GfxSurfaceCache,
  GfxSurfaceEffects,
  GfxLinearGradient,
  GfxRadialGradient,
  GfxPaint,
  GfxFill,
  GfxShadowStyle,
  SolidStrokeStyle,
} from '../render/gfx/Gfx2D'
export { cssLinearGradient } from '../render/gfx/cssGradient'
export { GfxPath } from '../render/gfx/GfxPath'
export type { FlatPath } from '../render/gfx/GfxPath'
export { RenderFailures } from '../render/gfx/RenderFailures'
export type { RenderFailure } from '../render/gfx/RenderFailures'
export type { FillRule } from '../render/gfx/stencilRecipe'
export type { StrokeAlign } from '../render/gfx/strokeOutline'
export { VectorQuality, SHADOW_SIGMA_BUDGETS } from '../render/VectorQuality'
export type {
  VectorQualityOptions,
  PathShadowFallback,
} from '../render/VectorQuality'
export { DataTexture, ShaderQuad, quadShader } from '../render/gfx/ShaderQuad'
export type {
  DataTextureOptions,
  QuadShaderSource,
  ShaderQuadOptions,
} from '../render/gfx/ShaderQuad'
export { resolveRadii } from '../render/gfx/roundRectRadii'
export {
  IOS_CORNER_SMOOTHING,
  fitSquircleCorners,
  squircleCorner,
  squircleCorners,
  squirclePath,
  squirclePath2D,
  squircleSvgPath,
} from '../render/gfx/squircle'
export type { SquircleCorner } from '../render/gfx/squircle'
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
