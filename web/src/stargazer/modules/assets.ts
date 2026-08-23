/**
 * Loading and preparing art. {@link AssetLoader} memoizes async loads by key.
 * {@link parseSvgPaths} turns an SVG string into named `Path2D`s (feed them to a
 * `Path2DNode`), and {@link buildBitmapMask} rasterizes a path into a
 * {@link BitmapMask} for O(1) inside/outside tests and GPU clipping.
 *
 * A `Path2D` only renders once a tessellation is registered for it.
 * `parseSvgPaths(svg, { tessellate: true })` does that for parsed artwork. A
 * path built in code goes through {@link flattenSvgPath} or the live
 * {@link flattenCubic} / {@link flattenQuadratic} subdividers, then
 * {@link tessellateContours}, then {@link registerPathTessellation}.
 *
 * @module assets
 */
export { AssetLoader } from '../assets/AssetLoader'
export { parseSvgPaths, computePathBounds } from '../assets/SvgPathMap'
export {
  flattenCubic,
  flattenQuadratic,
  flattenSvgPath,
  tessellateContours,
} from '../assets/SvgPathContours'
export {
  getPathContours,
  registerPathTessellation,
  releasePathTessellation,
} from '../render/gfx/PathTessellationRegistry'
export type {
  SvgPathMap,
  SvgPathEntry,
  ParseSvgPathsOptions,
} from '../assets/SvgPathMap'
export {
  rasterizeSvg,
  svgViewBoxSize,
  sizeSvgSource,
  isBlankRaster,
} from '../assets/rasterizeSvg'
export type { RasterizeSvgOptions } from '../assets/rasterizeSvg'
export { buildBitmapMask } from '../assets/BitmapMask'
export type { BitmapMask, BitmapMaskOptions } from '../assets/BitmapMask'
export { loadGltf, parseGltf } from '../assets/gltf'
