/**
 * Lottie animations. {@link parseLottie} turns Lottie JSON into a
 * {@link LottieAnimation}, and {@link LottiePlayer} advances a playhead over it
 * with loops, bounce modes, segments and markers. {@link computeLayout} fits the
 * animation's composition into a box.
 *
 * Anything the loader cannot use is listed in
 * {@link LottieAnimation.diagnostics} instead of throwing.
 *
 * @module lottie
 */
export { parseLottie } from '../lottie/model/parse'
export type * from '../lottie/model/types'
export { LottiePlayer } from '../lottie/player/LottiePlayer'
export type {
  AdvanceResult,
  LottiePlayerEvents,
  LottiePlayerOptions,
  PlaybackController,
  PlaybackMode,
  PlayerMarker,
  PlayerSource,
} from '../lottie/player/LottiePlayer'
export { computeLayout } from '../lottie/player/layout'
export type {
  LayoutAlign,
  LayoutFit,
  LayoutResult,
} from '../lottie/player/layout'
export {
  EasingCache,
  ValueProp,
  PathProp,
  parseProp,
  parsePathProp,
} from '../lottie/anim/props'
export type {
  Handles,
  PathData,
  PathShape,
  SpatialSegment,
} from '../lottie/anim/props'
export { LottieNode } from '../nodes/LottieNode'
export type {
  LottieNodeOptions,
  LottieOffscreenMode,
} from '../nodes/LottieNode'
export {
  parseDotLottie,
  loadLottie,
  loadDotLottie,
} from '../lottie/dotlottie/dotlottie'
export type {
  DotLottie,
  DotLottieAnimationEntry,
  DotLottieManifest,
  LottieFetch,
} from '../lottie/dotlottie/dotlottie'
export {
  applyTheme,
  parseTheme,
  resetSlots,
  setSlotValue,
} from '../lottie/dotlottie/theme'
export type {
  LottieGradientStopValue,
  LottieRuleKeyframe,
  LottieSlotValue,
  LottieTheme,
  LottieThemeRule,
} from '../lottie/dotlottie/theme'
export { readZip, extractZipEntry } from '../lottie/dotlottie/zip'
export type { ZipEntry } from '../lottie/dotlottie/zip'
