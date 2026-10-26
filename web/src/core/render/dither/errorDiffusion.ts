import type { PostDataInput, PostPassContext } from 'stargazer'
import type { DiffusionKernel, DitherSettings } from './params'

/** Rows of cells the compute shader keeps errors for. It leaves the rest empty. */
export const DIFFUSION_ROW_LIMIT = 800

const LUMA = [0.2126, 0.7152, 0.0722] as const

/** The sources of a cell's error and the share each passes on. */
const KERNELS: Record<
  DiffusionKernel,
  ReadonlyArray<readonly [number, number, number]>
> = {
  'floyd-steinberg': [
    [-1, 0, 7 / 16],
    [1, -1, 3 / 16],
    [0, -1, 5 / 16],
    [-1, -1, 1 / 16],
  ],
  // Six neighbors pass on an eighth each, so a quarter of the error is lost.
  atkinson: [
    [-1, 0, 1 / 8],
    [-2, 0, 1 / 8],
    [1, -1, 1 / 8],
    [0, -1, 1 / 8],
    [-1, -1, 1 / 8],
    [0, -2, 1 / 8],
  ],
}

/** Rounds halves to the even neighbor, as WGSL `round` does. */
export function roundHalfEven(value: number): number {
  const floor = Math.floor(value)
  const fraction = value - floor
  if (fraction < 0.5) return floor
  if (fraction > 0.5) return floor + 1
  return floor % 2 === 0 ? floor : floor + 1
}

/** Gamma, contrast and brightness on one channel, as `toneMap` in the shader. */
export function toneMap(
  value: number,
  settings: Pick<
    DitherSettings,
    'gamma' | 'contrast' | 'brightness' | 'invert'
  >,
): number {
  let tone = Math.pow(Math.max(value, 0), settings.gamma)
  tone = (tone - 0.5) * settings.contrast + 0.5 + settings.brightness
  tone = Math.min(Math.max(tone, 0), 1)
  return settings.invert ? 1 - tone : tone
}

/**
 * Rounds each tone to one of `levels` values and passes the error on to the
 * cells after it. `tones` is row by row from the top. The result holds the
 * level of each cell in 0..1.
 */
export function diffuseTones(
  tones: Float32Array,
  columns: number,
  rows: number,
  kernel: DiffusionKernel,
  levels: number,
): Float32Array {
  const steps = Math.max(levels, 2) - 1
  const taps = KERNELS[kernel]
  const errors = new Float32Array(columns * rows)
  const result = new Float32Array(columns * rows)
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      let incoming = 0
      for (const [dx, dy, share] of taps) {
        const x = column + dx
        const y = row + dy
        if (x < 0 || x >= columns || y < 0 || y >= rows) continue
        incoming += errors[y * columns + x] * share
      }
      const value = tones[row * columns + column] + incoming
      const level = Math.min(
        Math.max(
          roundHalfEven(Math.min(Math.max(value, -0.5), 1.5) * steps) / steps,
          0,
        ),
        1,
      )
      errors[row * columns + column] = value - level
      result[row * columns + column] = level
    }
  }
  return result
}

/**
 * The diffusion on the CPU, for a device without compute. Reads the cells'
 * colors from `input`, as the compute shader reads the cells texture, and
 * writes each cell's level into the red channel of `output`.
 */
export function diffuseCells(
  input: PostDataInput,
  output: Uint8ClampedArray,
  ctx: PostPassContext,
  settings: DitherSettings,
): void {
  const columns = ctx.width
  const rows = Math.min(ctx.height, DIFFUSION_ROW_LIMIT)
  // The texture's rows run top to bottom on one backend and bottom to top on
  // the other. The diffusion goes from the top either way.
  const nativeRow = (row: number) => (ctx.uvYDown ? row : ctx.height - 1 - row)
  const tones = new Float32Array(columns * rows)
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const at = (nativeRow(row) * columns + column) * 4
      const alpha = input.data[at + 3] / 255
      const opaque = Math.max(alpha, 1e-4)
      const luma =
        (LUMA[0] * input.data[at] +
          LUMA[1] * input.data[at + 1] +
          LUMA[2] * input.data[at + 2]) /
        255 /
        opaque
      tones[row * columns + column] =
        settings.alphaThreshold > 0 && alpha < settings.alphaThreshold
          ? 0
          : toneMap(luma, settings)
    }
  }
  const levels =
    settings.palette === 'ramp'
      ? Math.min(settings.colors.length, 16)
      : settings.levels
  const result = diffuseTones(tones, columns, rows, settings.kernel, levels)
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const at = (nativeRow(row) * columns + column) * 4
      output[at] = Math.round(result[row * columns + column] * 255)
      output[at + 3] = 255
    }
  }
}
