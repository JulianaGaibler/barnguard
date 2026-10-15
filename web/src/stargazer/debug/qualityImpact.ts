import type { QualityGroup, QualityValues } from '../render/qualityGroups'

// What each quality option costs and what it changes, for the quality panel.
// Memory and pixel counts are computed from the canvas as it is now. Frame time
// is not predicted: the only figures given are ones measured on reference
// hardware, named as such, because the same option saves very different
// amounts on different GPUs.

/** The scene and display an option is being judged against. */
export interface ImpactContext {
  /** The canvas backing store now, in device pixels. */
  pixelW: number
  pixelH: number
  /** The render scale now, which `pixelW` and `pixelH` already include. */
  scale: number
  /** MSAA samples now. */
  samples: number
  backend: 'webgpu' | 'webgl2'
  /** The scene has 3D content, without which the 3D settings do nothing. */
  has3D: boolean
  /** Ambient occlusion resolution now. */
  aoResolution: 'full' | 'half'
}

/** What one option costs and changes. */
export interface Impact {
  /** Render-target memory the option holds, in bytes, where it holds any. */
  memory: number | null
  /** The share of native-resolution pixel work, `1` at full resolution. */
  pixelShare: number | null
  /** A measured saving, with where it was measured. */
  reference: string | null
  /** Why the option changes nothing at the moment, or `null` when it does. */
  inert: string | null
  /** What the picture looks like at this value. */
  look: string
}

/** Bytes per pixel of the colour target and of depth and stencil, per sample. */
const COLOR_BYTES = 4
const DEPTH_BYTES = 4
/**
 * Bytes per pixel of the ambient occlusion targets at full resolution: the
 * normal and depth buffer, the occlusion result and its blur.
 */
const AO_BYTES = 16

/** Memory of the main colour and depth targets for `pixels` at `samples`. */
export function targetBytes(pixels: number, samples: number): number {
  const msaa = pixels * (COLOR_BYTES + DEPTH_BYTES) * samples
  // A multisampled target also keeps a single-sample copy to resolve into.
  return samples > 1 ? msaa + pixels * COLOR_BYTES : msaa
}

/** Memory of the ambient occlusion targets for `pixels` at `resolution`. */
export function aoBytes(pixels: number, resolution: 'full' | 'half'): number {
  return pixels * AO_BYTES * (resolution === 'half' ? 0.25 : 1)
}

/** Pixels at native resolution, taking the render scale out of the canvas. */
function nativePixels(ctx: ImpactContext): number {
  return (ctx.pixelW * ctx.pixelH) / (ctx.scale * ctx.scale)
}

const NO_3D = 'The scene has no 3D content, so this changes nothing here.'

/** The effect of setting `group` to `value` with everything else as it is. */
export function impactOf<G extends QualityGroup>(
  group: G,
  value: QualityValues[G],
  ctx: ImpactContext,
): Impact {
  const native = nativePixels(ctx)
  switch (group) {
    case 'scale': {
      const s = value as number
      return {
        memory: targetBytes(native * s * s, ctx.samples),
        pixelShare: s * s,
        reference:
          s === 0.75
            ? 'About 39% less frame time (Intel Iris Xe, 4K, MSAA 4)'
            : null,
        inert: null,
        look:
          s >= 1
            ? 'Native resolution'
            : s >= 0.85
              ? 'Slightly soft'
              : s >= 0.7
                ? 'Soft, fine text and lines blur'
                : 'Visibly soft',
      }
    }
    case 'msaa': {
      const requested = value as number
      const n = ctx.backend === 'webgpu' && requested === 2 ? 1 : requested
      return {
        memory: targetBytes(ctx.pixelW * ctx.pixelH, n),
        pixelShare: null,
        reference:
          requested === 2
            ? 'About 9% less frame time than 4× (Intel Iris Xe, 4K)'
            : null,
        inert:
          ctx.backend === 'webgpu' && requested === 2
            ? 'WebGPU has no 2× mode, so this runs as 1×.'
            : null,
        look:
          n <= 1
            ? 'Jagged edges'
            : n === 2
              ? 'Mild edge smoothing'
              : n === 4
                ? 'Smooth edges'
                : 'Smoothest edges',
      }
    }
    case 'shadows': {
      const taps = value as number
      return {
        memory: null,
        pixelShare: null,
        reference: null,
        inert: ctx.has3D ? null : NO_3D,
        look:
          taps === 0
            ? 'No shadows'
            : taps === 1
              ? 'Hard shadow edges'
              : taps === 4
                ? 'Slightly soft edges'
                : taps === 9
                  ? 'Soft edges'
                  : 'Softest edges',
      }
    }
    case 'aoPreset': {
      const preset = value as QualityValues['aoPreset']
      return {
        memory:
          preset === 'off'
            ? 0
            : aoBytes(ctx.pixelW * ctx.pixelH, ctx.aoResolution),
        pixelShare: null,
        reference: null,
        inert: ctx.has3D ? null : NO_3D,
        look:
          preset === 'off'
            ? 'No ambient occlusion'
            : preset === 'low'
              ? 'Faint contact shadowing'
              : preset === 'medium'
                ? 'Clear contact shadowing'
                : 'Smoothest contact shadowing',
      }
    }
    case 'aoResolution': {
      const res = value as 'full' | 'half'
      return {
        memory: aoBytes(ctx.pixelW * ctx.pixelH, res),
        pixelShare: res === 'half' ? 0.25 : 1,
        reference:
          res === 'half'
            ? 'About 39% less frame time, looks the same (Intel Iris Xe, 4K)'
            : null,
        inert: ctx.has3D ? null : NO_3D,
        look:
          res === 'half'
            ? 'Occlusion at a quarter of the pixels'
            : 'Occlusion at every pixel',
      }
    }
  }
  throw new Error(`unknown quality group ${String(group)}`)
}

/** Memory of every render target at `values`, for the panel's total. */
export function totalTargetBytes(
  values: QualityValues,
  ctx: ImpactContext,
): number {
  const native = nativePixels(ctx)
  const px = native * values.scale * values.scale
  const n = ctx.backend === 'webgpu' && values.msaa === 2 ? 1 : values.msaa
  let bytes = targetBytes(px, n)
  if (ctx.has3D && values.aoPreset !== 'off') {
    bytes += aoBytes(px, values.aoResolution)
  }
  return bytes
}

// --- what is limiting the frame ---------------------------------------------

/** What the frame is waiting on. */
export type Limiter = 'gpu' | 'cpu' | 'none' | 'unknown'

export interface Headroom {
  /** Frames are arriving later than the display or the cap wants. */
  behind: boolean
  limiter: Limiter
  /** Share of the frame budget the CPU work takes, its slowest 5%. */
  cpuShare: number
  /** Share of the frame budget the GPU takes, or `null` when it cannot be timed. */
  gpuShare: number | null
  /** One sentence on what to do. */
  advice: string
}

export interface HeadroomInput {
  /** Median interval between frames, in seconds. */
  interval50: number
  /** Median CPU work per frame, in seconds. */
  work50: number
  /** Slowest 5% of CPU work per frame, in seconds. */
  work95: number
  /** Median GPU time per frame, in milliseconds, or `null`. */
  gpuMs: number | null
  /** The frame cap, `0` for none. */
  maxFps: number
}

/** A median interval above this is too slow, as the adaptive controller sees it. */
const SLOW_INTERVAL = 0.037
/** The frame is GPU-bound when CPU work is under this share of the interval. */
const GPU_BOUND_SHARE = 0.5

/**
 * Whether the frame is keeping up, what limits it and how much room is left,
 * using the same rule the adaptive controller uses to decide a frame is waiting
 * on the GPU, so the panel and the engine agree.
 */
export function headroom(i: HeadroomInput): Headroom {
  if (i.interval50 <= 0) {
    return {
      behind: false,
      limiter: 'unknown',
      cpuShare: 0,
      gpuShare: null,
      advice: 'Waiting for frames.',
    }
  }
  const budgetMs = i.maxFps > 0 ? 1000 / i.maxFps : 1000 / 60
  const slow =
    i.maxFps > 0 ? Math.max(SLOW_INTERVAL, 1.3 / i.maxFps) : SLOW_INTERVAL
  const behind = i.interval50 > slow
  const cpuShare = (i.work95 * 1000) / budgetMs
  const gpuShare = i.gpuMs === null ? null : i.gpuMs / budgetMs

  if (behind) {
    const cpuBound = i.work50 > i.interval50 * GPU_BOUND_SHARE
    return {
      behind,
      limiter: cpuBound ? 'cpu' : 'gpu',
      cpuShare,
      gpuShare,
      advice: cpuBound
        ? 'Falling behind on the CPU. Lowering quality will not help. Look at draw calls and repainting.'
        : 'Falling behind on the GPU. Lower the render scale, MSAA or AO.',
    }
  }
  const worst = Math.max(cpuShare, gpuShare ?? 0)
  const limiter: Limiter =
    worst < GPU_BOUND_SHARE
      ? 'none'
      : gpuShare !== null && gpuShare > cpuShare
        ? 'gpu'
        : 'cpu'
  return {
    behind,
    limiter,
    cpuShare,
    gpuShare,
    advice:
      worst < GPU_BOUND_SHARE
        ? `Keeping up with ${Math.round((1 - worst) * 100)}% of the frame to spare. Quality can go up.`
        : worst < 0.85
          ? 'Keeping up, with some room left.'
          : 'Keeping up, with almost no room left.',
  }
}
