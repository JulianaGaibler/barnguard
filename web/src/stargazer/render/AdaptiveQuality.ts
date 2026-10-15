import type { AoPreset, AoResolution } from './gfx/ao/AmbientOcclusion'
import { tierGroup, type QualityGroup } from './qualityGroups'

/** Tuning for {@link AdaptiveQuality}. */
export interface AdaptiveQualityOptions {
  /**
   * Seconds of frames per decision. Measured in time rather than frames, so a
   * slow frame rate is answered as quickly as a fast one. Default 1.5.
   */
  windowSec?: number
  /** Fewest frames a decision is based on, however long they take. Default 10. */
  minWindowFrames?: number
  /** Seconds ignored at the start and after every change. Default 1. */
  settleSec?: number
  /**
   * A median frame interval above this, in seconds, is too slow. Default 0.037,
   * below the 30 Hz of a slow display.
   */
  slowInterval?: number
  /**
   * A median frame interval above this, in seconds, is so slow that one
   * decision takes half of the tiers left instead of one. Default 0.074, twice
   * the default slow interval.
   */
  severeInterval?: number
  /**
   * The frame counts as GPU-bound when the CPU work is under this share of the
   * interval. Default 0.5.
   */
  gpuBoundShare?: number
  /**
   * Intervals above this, in seconds, are stalls and are not counted. Default
   * 0.25.
   */
  stallInterval?: number
  /** The tiers to walk, in order. Default {@link ADAPTIVE_LADDER}. */
  ladder?: readonly QualityTier[]
}

/** One setting lowered by one notch. */
export type QualityTier =
  | { kind: 'aoResolution'; resolution: AoResolution }
  | { kind: 'aoPreset'; preset: AoPreset }
  | { kind: 'ao'; enabled: false }
  | { kind: 'msaa'; samples: number }
  | { kind: 'shadowSoftness'; taps: number }
  | { kind: 'shadows'; enabled: false }
  | { kind: 'scale'; scale: number }

/** The settings in use now, which decide the tiers that still lower anything. */
export interface QualitySnapshot {
  samples: number
  scale: number
  /** The backend only offers 1 or 4 samples. */
  webgpu: boolean
  /** The scene has 3D content, without which the 3D tiers change nothing. */
  has3D: boolean
  shadows: boolean
  shadowSoftness: number
  ao: boolean
  aoPreset: AoPreset
  aoResolution: AoResolution
  /** The engine's frame cap, `0` for none. */
  maxFps: number
  /**
   * Settings a person pinned to a value. No tier lowers one of these, so a
   * pinned setting stays where it was put.
   */
  pinned?: readonly QualityGroup[]
}

/**
 * The default order, most frame time saved for the least visible loss first.
 * Measured on an integrated GPU at a pixel density of 2 with MSAA 4, medium AO
 * and 9-tap shadows, where half-resolution AO saved 39% of the frame and looked
 * the same, MSAA 2x saved 9% and a render scale of 0.75 saved 39%. Shadow map
 * size saved nothing measurable, so it is not a tier. Turning AO or shadows off
 * changes the look of a scene, so those come after the render scale has reached
 * 0.75.
 */
export const ADAPTIVE_LADDER: readonly QualityTier[] = [
  { kind: 'aoResolution', resolution: 'half' },
  { kind: 'msaa', samples: 2 },
  { kind: 'aoPreset', preset: 'low' },
  { kind: 'msaa', samples: 1 },
  { kind: 'shadowSoftness', taps: 4 },
  { kind: 'scale', scale: 0.85 },
  { kind: 'scale', scale: 0.75 },
  { kind: 'shadowSoftness', taps: 1 },
  { kind: 'scale', scale: 0.6 },
  { kind: 'ao', enabled: false },
  { kind: 'shadows', enabled: false },
  { kind: 'scale', scale: 0.5 },
]

const AO_PRESET_RANK: Record<AoPreset, number> = { low: 0, medium: 1, high: 2 }

/** Whether `tier` would lower anything from `s`. */
export function tierLowers(tier: QualityTier, s: QualitySnapshot): boolean {
  if (s.pinned?.includes(tierGroup(tier.kind))) return false
  switch (tier.kind) {
    case 'msaa':
      // WebGPU has no 2x, so its 4x goes straight to the 1x tier.
      if (s.webgpu && tier.samples === 2) return false
      return s.samples > tier.samples
    case 'scale':
      return s.scale > tier.scale + 1e-6
    case 'aoResolution':
      return s.has3D && s.ao && s.aoResolution === 'full'
    case 'aoPreset':
      return (
        s.has3D &&
        s.ao &&
        AO_PRESET_RANK[s.aoPreset] > AO_PRESET_RANK[tier.preset]
      )
    case 'ao':
      return s.has3D && s.ao
    case 'shadowSoftness':
      return s.has3D && s.shadows && s.shadowSoftness > tier.taps
    case 'shadows':
      return s.has3D && s.shadows
  }
}

/** `s` with `tier` applied. */
export function applyTier(
  tier: QualityTier,
  s: QualitySnapshot,
): QualitySnapshot {
  switch (tier.kind) {
    case 'msaa':
      return { ...s, samples: tier.samples }
    case 'scale':
      return { ...s, scale: tier.scale }
    case 'aoResolution':
      return { ...s, aoResolution: tier.resolution }
    case 'aoPreset':
      return { ...s, aoPreset: tier.preset }
    case 'ao':
      return { ...s, ao: false }
    case 'shadowSoftness':
      return { ...s, shadowSoftness: tier.taps }
    case 'shadows':
      return { ...s, shadows: false }
  }
}

/** Frames the window can hold, enough for its duration at a fast display. */
const WINDOW_CAPACITY = 512

/**
 * Decides when to give up quality because the GPU cannot keep up, walking an
 * ordered ladder of tiers that each lower one setting a notch: AO resolution
 * and preset, MSAA, shadow softness, render scale, and last turning AO and
 * shadows off. A frame far over budget takes half of the tiers left in one
 * decision.
 *
 * @remarks
 *   For engine developers: a pure state machine, fed one sample per frame with
 *   the settings in use. It watches the true frame interval and the CPU work
 *   per frame. When the median interval over a window is slow and the CPU work
 *   is a small part of it, the frame is waiting on the GPU. A tier that would
 *   not lower anything from the current settings is skipped, so a 2D scene
 *   walks only MSAA and the render scale, and a setting the caller lowered on
 *   its own is not lowered again.
 *
 *   It only steps down and never back up, because each change rebuilds a render
 *   target and a controller that flips would stutter. Outside a benchmark there
 *   is no GPU timer to say how much headroom a frame that keeps up has left. A
 *   frame that is slow because of CPU work, a frame cap or a stall is not a
 *   reason to change anything.
 */
export class AdaptiveQuality {
  readonly #window: number
  readonly #minFrames: number
  readonly #settle: number
  readonly #slow: number
  readonly #severe: number
  readonly #share: number
  readonly #stall: number
  readonly #ladder: readonly QualityTier[]
  readonly #intervals = new Float64Array(WINDOW_CAPACITY)
  readonly #work = new Float64Array(WINDOW_CAPACITY)
  #count = 0
  #elapsed = 0
  /** Seconds left to ignore before measuring again. */
  #skip: number
  #lastKey = ''

  constructor(opts: AdaptiveQualityOptions = {}) {
    this.#window = opts.windowSec ?? 1.5
    this.#minFrames = opts.minWindowFrames ?? 10
    this.#settle = opts.settleSec ?? 1
    this.#slow = opts.slowInterval ?? 0.037
    this.#severe = opts.severeInterval ?? 0.074
    this.#share = opts.gpuBoundShare ?? 0.5
    this.#stall = opts.stallInterval ?? 0.25
    this.#ladder = opts.ladder ?? ADAPTIVE_LADDER
    this.#skip = this.#settle
  }

  #restart(): void {
    this.#skip = this.#settle
    this.#count = 0
    this.#elapsed = 0
  }

  /**
   * Feed one frame. Returns the tiers to apply, in order, or `null` to keep the
   * current quality.
   *
   * @param interval - The true time since the last frame, in seconds.
   * @param workSec - CPU time spent in the frame, in seconds.
   * @param settings - The settings in use now.
   */
  update(
    interval: number,
    workSec: number,
    settings: QualitySnapshot,
  ): QualityTier[] | null {
    const key = snapshotKey(settings)
    if (key !== this.#lastKey) {
      // A change, ours or the caller's, rebuilds a target. Start over.
      this.#lastKey = key
      this.#restart()
    }
    if (interval <= 0 || interval > this.#stall) return null
    if (this.#skip > 0) {
      this.#skip -= interval
      return null
    }
    this.#intervals[this.#count] = interval
    this.#work[this.#count] = workSec
    this.#count++
    this.#elapsed += interval
    const full = this.#count >= WINDOW_CAPACITY
    if (
      !full &&
      (this.#elapsed < this.#window || this.#count < this.#minFrames)
    ) {
      return null
    }
    const count = this.#count
    this.#count = 0
    this.#elapsed = 0

    // A capped engine runs at its cap on purpose, so slow means slower than that.
    const max = settings.maxFps
    const slow = max > 0 ? Math.max(this.#slow, 1.3 / max) : this.#slow
    const interval50 = median(this.#intervals, count)
    if (interval50 <= slow) return null
    if (median(this.#work, count) > interval50 * this.#share) return null

    const left = this.#remaining(settings)
    if (left.length === 0) return null
    this.#restart()
    const severe = interval50 > Math.max(this.#severe, slow * 2)
    return left.slice(0, severe ? Math.ceil(left.length / 2) : 1)
  }

  /** The tiers that would still lower something, in order, from `s`. */
  #remaining(s: QualitySnapshot): QualityTier[] {
    const out: QualityTier[] = []
    let at = s
    for (const tier of this.#ladder) {
      if (!tierLowers(tier, at)) continue
      out.push(tier)
      at = applyTier(tier, at)
    }
    return out
  }
}

function snapshotKey(s: QualitySnapshot): string {
  return [
    s.samples,
    s.scale,
    s.shadows,
    s.shadowSoftness,
    s.ao,
    s.aoPreset,
    s.aoResolution,
    s.pinned?.join(',') ?? '',
  ].join('|')
}

function median(values: Float64Array, count: number): number {
  return values.slice(0, count).sort()[count >> 1]
}
