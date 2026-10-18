import { parseColor, type PostSourceInfo } from '@src/stargazer'

/** How a cell's tone decides between ink and paper. */
export type DitherPattern =
  | 'bayer2'
  | 'bayer4'
  | 'bayer8'
  | 'blue-noise'
  | 'white-noise'
  | 'gradient-noise'
  | 'diffusion'
  | 'none'

/** The shape drawn in each cell. The `-am` shapes grow with the tone. */
export type DitherDot =
  'square' | 'square-inset' | 'circle' | 'circle-am' | 'square-am'

/** How a cell gets its color. */
export type DitherPalette = 'mono' | 'ramp' | 'nearest' | 'source'

/**
 * What the grid is fixed to. `'screen'` keeps one grid on the canvas and lets
 * content slide under it. `'layer'` fixes the grid to the layer's own origin,
 * so it moves with the layer.
 */
export type DitherAnchor = 'screen' | 'layer'

/** The error spread of the `'diffusion'` pattern. */
export type DiffusionKernel = 'floyd-steinberg' | 'atkinson'

/** Every setting of a {@link Dither}. */
export interface DitherSettings {
  /** The width of a cell, in the owner's units. */
  cellSize: number
  /** Round the cell and the grid origin to whole device pixels. */
  snap: boolean
  anchor: DitherAnchor
  pattern: DitherPattern
  dot: DitherDot
  palette: DitherPalette
  /**
   * Tone levels of a threshold pattern. 2 is one bit. 0 keeps the tone as it
   * is.
   */
  levels: number
  /** Reseed a noise pattern every frame. */
  temporal: boolean
  kernel: DiffusionKernel
  gamma: number
  contrast: number
  brightness: number
  /** Dark input becomes ink instead of light input. */
  invert: boolean
  /** The dot width relative to the cell, or a gain on the `-am` shapes. */
  dotScale: number
  /** The smallest radius of an `-am` shape, in cells. */
  dotMin: number
  /** The width of a dot's soft edge, in the owner's units. */
  softness: number
  /** Cells whose source alpha is below this are left clear. 0 draws every cell. */
  alphaThreshold: number
  /** How far `'nearest'` nudges a color by the threshold before it snaps. */
  paletteSpread: number
  /** CSS color of an empty cell. A transparent color leaves the gaps clear. */
  paper: string
  /** CSS color of a full cell. */
  ink: string
  /** Up to 16 CSS colors for the `'ramp'` and `'nearest'` palettes. */
  colors: readonly string[]
}

export const DEFAULT_DITHER: Readonly<DitherSettings> = {
  cellSize: 6,
  snap: true,
  anchor: 'screen',
  pattern: 'bayer8',
  dot: 'square',
  palette: 'mono',
  levels: 2,
  temporal: false,
  kernel: 'floyd-steinberg',
  gamma: 1,
  contrast: 1,
  brightness: 0,
  invert: false,
  dotScale: 1,
  dotMin: 0,
  softness: 0.01,
  alphaThreshold: 0,
  paletteSpread: 0.3,
  paper: '#000000',
  ink: '#ffffff',
  colors: [],
}

/**
 * Bytes of the params block: 8 vec4 of numbers, 2 colors and 16 palette
 * entries.
 */
export const DITHER_PARAMS_BYTES = 416

/** The order of these names is the pattern code the shader switches on. */
const PATTERNS: readonly DitherPattern[] = [
  'bayer2',
  'bayer4',
  'bayer8',
  'blue-noise',
  'white-noise',
  'gradient-noise',
  'diffusion',
  'none',
]
const DOTS: readonly DitherDot[] = [
  'square',
  'square-inset',
  'circle',
  'circle-am',
  'square-am',
]
const PALETTES: readonly DitherPalette[] = ['mono', 'ramp', 'nearest', 'source']

const MAX_TAPS = 8
const MAX_COLORS = 16
/** Frames a second of a temporal pattern. */
const TEMPORAL_HZ = 60

/** The cell grid over one surface, in device pixels. */
export interface DitherGrid {
  cellPx: number
  /** Where the grid starts on the surface. */
  originX: number
  originY: number
  /** The grid position of the surface's top-left cell. */
  firstColumn: number
  firstRow: number
  columns: number
  rows: number
  /** Samples per cell side when the cells pass averages. */
  taps: number
}

/** Lays the cell grid over `source`. */
export function gridFor(
  settings: Pick<DitherSettings, 'cellSize' | 'snap' | 'anchor'>,
  source: PostSourceInfo,
): DitherGrid {
  let cellPx = Math.max(settings.cellSize * source.pxPerUnit, 0.5)
  let originX =
    settings.anchor === 'layer' ? source.unitOriginX : -source.originX
  let originY =
    settings.anchor === 'layer' ? source.unitOriginY : -source.originY
  if (settings.snap) {
    cellPx = Math.max(1, Math.round(cellPx))
    originX = Math.round(originX)
    originY = Math.round(originY)
  }
  // Pixel centers decide which cell a pixel belongs to.
  const firstColumn = Math.floor((0.5 - originX) / cellPx)
  const firstRow = Math.floor((0.5 - originY) / cellPx)
  const lastColumn = Math.floor((source.width - 0.5 - originX) / cellPx)
  const lastRow = Math.floor((source.height - 0.5 - originY) / cellPx)
  return {
    cellPx,
    originX,
    originY,
    firstColumn,
    firstRow,
    columns: lastColumn - firstColumn + 1,
    rows: lastRow - firstRow + 1,
    taps: Math.min(MAX_TAPS, Math.max(1, Math.ceil(cellPx / 2))),
  }
}

/**
 * Writes the params block, in the order of `DitherParams` in `dither.inc.wgsl`.
 * `time` is the chain's clock, used by temporal patterns.
 */
export function packDitherParams(
  settings: DitherSettings,
  source: PostSourceInfo,
  grid: DitherGrid,
  textureRowsTopDown: boolean,
  time: number,
  out: Float32Array,
): void {
  const colors = settings.colors.slice(0, MAX_COLORS)
  const frame = settings.temporal ? Math.floor(time * TEMPORAL_HZ) : 0
  out.set(
    [
      source.width,
      source.height,
      grid.cellPx,
      textureRowsTopDown ? 1 : 0,
      grid.originX,
      grid.originY,
      grid.firstColumn,
      grid.firstRow,
      grid.columns,
      grid.rows,
      grid.taps,
      frame,
      PATTERNS.indexOf(settings.pattern),
      DOTS.indexOf(settings.dot),
      PALETTES.indexOf(settings.palette),
      settings.levels,
      settings.temporal ? 1 : 0,
      settings.kernel === 'atkinson' ? 1 : 0,
      colors.length,
      0,
      settings.gamma,
      settings.contrast,
      settings.brightness,
      settings.invert ? 1 : 0,
      settings.dotScale,
      settings.dotMin,
      settings.softness * source.pxPerUnit,
      settings.alphaThreshold,
      settings.paletteSpread,
      0,
      0,
      0,
    ],
    0,
  )
  writeColor(settings.paper, out, 32)
  writeColor(settings.ink, out, 36)
  for (let index = 0; index < colors.length; index++) {
    writeColor(colors[index], out, 40 + index * 4)
  }
}

function writeColor(css: string, out: Float32Array, at: number): void {
  const color = parseColor(css)
  out[at] = color.r
  out[at + 1] = color.g
  out[at + 2] = color.b
  out[at + 3] = color.a
}
