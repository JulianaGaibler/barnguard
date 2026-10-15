import type { AoPreset, AoResolution } from './gfx/ao/AmbientOcclusion'

/**
 * The settings the engine can lower on its own when the GPU cannot keep up, and
 * that a person can instead pin to a fixed value. Each is one row in the
 * quality panel, set to auto or to a value.
 */
export type QualityGroup =
  'msaa' | 'scale' | 'aoPreset' | 'aoResolution' | 'shadows'

/** Every group, in the order the quality panel lists them. */
export const QUALITY_GROUPS: readonly QualityGroup[] = [
  'scale',
  'msaa',
  'shadows',
  'aoPreset',
  'aoResolution',
]

/** The value of each group. */
export interface QualityValues {
  /** MSAA sample count: 1, 2, 4 or 8. */
  msaa: number
  /** Factor applied to the device pixel ratio, 1 for native. */
  scale: number
  /** Ambient occlusion preset, `'off'` when it is disabled. */
  aoPreset: 'off' | AoPreset
  aoResolution: AoResolution
  /** Shadow filter taps (1, 4, 9 or 16), `0` when shadows are off. */
  shadows: number
}

/** The group a ladder tier lowers. */
export function tierGroup(kind: string): QualityGroup {
  switch (kind) {
    case 'msaa':
      return 'msaa'
    case 'scale':
      return 'scale'
    case 'aoResolution':
      return 'aoResolution'
    case 'aoPreset':
    case 'ao':
      return 'aoPreset'
    default:
      return 'shadows'
  }
}
