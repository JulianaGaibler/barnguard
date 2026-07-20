/**
 * Loading and preparing art. {@link AssetLoader} memoizes async loads by key.
 * {@link parseSvgPaths} turns an SVG string into named `Path2D`s (feed them to a
 * `Path2DNode`), and {@link buildBitmapMask} rasterizes a path into a
 * {@link BitmapMask} for O(1) inside/outside tests and GPU clipping.
 *
 * @module assets
 * @category Assets
 */
export { AssetLoader } from '../assets/AssetLoader'
export { parseSvgPaths, computePathBounds } from '../assets/SvgPathMap'
export type {
  SvgPathMap,
  SvgPathEntry,
  ParseSvgPathsOptions,
} from '../assets/SvgPathMap'
export { buildBitmapMask } from '../assets/BitmapMask'
export type { BitmapMask, BitmapMaskOptions } from '../assets/BitmapMask'
