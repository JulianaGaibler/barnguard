import { DEFAULT_DITHER, type DitherSettings } from './params'

/**
 * Colors picked by eye from the brand's reference images. They stand in until a
 * display supplies its own.
 */
export const KIT_COLORS = {
  black: '#000000',
  white: '#ffffff',
  green: '#00d230',
  greenMid: '#1e8a3c',
  greenDark: '#1a4126',
  orangeLight: '#ffaa66',
  orange: '#ff7a3e',
  red: '#ff3b2e',
  purpleDark: '#5a0ba6',
  purple: '#8a2be2',
  purpleLight: '#b27cf0',
  pink: '#ff9bea',
  stage: '#1c1c1c',
  paperGrey: '#9a9a9a',
} as const

type Preset = Partial<DitherSettings> & { description: string }

/**
 * One preset per reference image. The cell sizes are for a frame 1080 units
 * high, which is what a layer with a 1920 by 1080 frame has.
 */
export const DITHER_PRESETS = {
  halftoneSphere: {
    description: 'Round halftone dots that grow with the shade, black on green',
    pattern: 'none',
    dot: 'circle-am',
    palette: 'mono',
    levels: 0,
    invert: true,
    cellSize: 14,
    dotScale: 1,
    dotMin: 0.06,
    softness: 0.9,
    contrast: 1.15,
    paper: KIT_COLORS.green,
    ink: KIT_COLORS.black,
  },
  bitmapPaletteMegaphone: {
    description: 'Coarse ordered dither snapped to green and orange',
    pattern: 'bayer4',
    dot: 'square-inset',
    palette: 'nearest',
    cellSize: 8,
    dotScale: 0.88,
    paletteSpread: 0.32,
    contrast: 1.1,
    paper: KIT_COLORS.black,
    ink: KIT_COLORS.green,
    colors: [
      KIT_COLORS.black,
      KIT_COLORS.greenDark,
      KIT_COLORS.greenMid,
      KIT_COLORS.green,
      KIT_COLORS.red,
      KIT_COLORS.orange,
      KIT_COLORS.orangeLight,
    ],
  },
  bitmapPaletteFlower: {
    description: 'Coarse 2 by 2 ordered dither snapped to purple and green',
    pattern: 'bayer2',
    dot: 'square-inset',
    palette: 'nearest',
    cellSize: 8,
    dotScale: 0.9,
    paletteSpread: 0.28,
    contrast: 1.05,
    paper: KIT_COLORS.black,
    ink: KIT_COLORS.pink,
    colors: [
      KIT_COLORS.black,
      KIT_COLORS.purpleDark,
      KIT_COLORS.purple,
      KIT_COLORS.purpleLight,
      KIT_COLORS.pink,
      KIT_COLORS.greenDark,
      KIT_COLORS.greenMid,
      KIT_COLORS.green,
    ],
  },
  errorDiffusionGlobe: {
    description: 'Atkinson error diffusion, one-bit green pixels on black',
    pattern: 'diffusion',
    kernel: 'atkinson',
    dot: 'square',
    palette: 'mono',
    levels: 2,
    cellSize: 6,
    gamma: 0.85,
    contrast: 1.3,
    paper: KIT_COLORS.black,
    ink: KIT_COLORS.green,
  },
  blueNoiseGlobe: {
    description:
      'Blue-noise pixels, a stand-in for error diffusion on moving content',
    pattern: 'blue-noise',
    dot: 'square',
    palette: 'mono',
    levels: 2,
    cellSize: 6,
    gamma: 0.85,
    contrast: 1.3,
    paper: KIT_COLORS.black,
    ink: KIT_COLORS.green,
  },
  stippleCloud: {
    description: 'Blue-noise stipple, round white dots of one size on black',
    pattern: 'blue-noise',
    dot: 'circle',
    palette: 'mono',
    levels: 2,
    cellSize: 3,
    dotScale: 0.78,
    softness: 0.6,
    gamma: 1.5,
    contrast: 1.2,
    paper: KIT_COLORS.black,
    ink: KIT_COLORS.white,
  },
  stageMountain: {
    description: 'Fine ordered dither, inset green squares on near black',
    pattern: 'bayer8',
    dot: 'square-inset',
    palette: 'mono',
    levels: 2,
    cellSize: 7,
    dotScale: 0.72,
    gamma: 1.1,
    contrast: 1.25,
    paper: KIT_COLORS.stage,
    ink: KIT_COLORS.green,
  },
  paperMountain: {
    description: 'Fine ordered dither, small grey dots on white',
    pattern: 'bayer8',
    dot: 'square-inset',
    palette: 'mono',
    levels: 2,
    cellSize: 3,
    dotScale: 0.85,
    softness: 0.3,
    gamma: 1.1,
    contrast: 1.1,
    paper: KIT_COLORS.white,
    ink: KIT_COLORS.paperGrey,
  },
  overlayStipple: {
    description: 'Stipple with clear gaps, for drawing over live content',
    pattern: 'blue-noise',
    dot: 'circle',
    palette: 'mono',
    levels: 2,
    cellSize: 3,
    dotScale: 0.78,
    softness: 0.6,
    gamma: 1.5,
    paper: 'rgba(0, 0, 0, 0)',
    ink: KIT_COLORS.white,
  },
} as const satisfies Record<string, Preset>

export type DitherPresetName = keyof typeof DITHER_PRESETS

/** The settings of a preset, with `overrides` applied over them. */
export function ditherPreset(
  name: DitherPresetName,
  overrides: Partial<DitherSettings> = {},
): DitherSettings {
  const { description: _description, ...preset } = DITHER_PRESETS[name]
  return {
    ...DEFAULT_DITHER,
    ...(preset as Partial<DitherSettings>),
    ...overrides,
  }
}
