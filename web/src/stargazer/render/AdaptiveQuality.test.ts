import { describe, expect, it } from 'vitest'
import {
  AdaptiveQuality,
  applyTier,
  type QualitySnapshot,
  type QualityTier,
} from './AdaptiveQuality'

/** A 3D scene at the engine's defaults, with AO on. */
const SCENE_3D: QualitySnapshot = {
  samples: 4,
  scale: 1,
  webgpu: false,
  has3D: true,
  shadows: true,
  shadowSoftness: 9,
  ao: true,
  aoPreset: 'medium',
  aoResolution: 'full',
  maxFps: 0,
}

const SCENE_2D: QualitySnapshot = {
  ...SCENE_3D,
  has3D: false,
  ao: false,
}

/** Feed up to `n` identical frames and return the first tiers asked for. */
function feed(
  a: AdaptiveQuality,
  n: number,
  interval: number,
  work: number,
  settings: QualitySnapshot,
): QualityTier[] | null {
  for (let i = 0; i < n; i++) {
    const tiers = a.update(interval, work, settings)
    if (tiers) return tiers
  }
  return null
}

/** Walk the ladder at a steady slow frame, applying each step, and list them. */
function walk(start: QualitySnapshot, interval = 0.05): QualityTier[] {
  const a = new AdaptiveQuality()
  const taken: QualityTier[] = []
  let at = start
  for (;;) {
    const tiers = feed(a, 200, interval, 0.002, at)
    if (!tiers) return taken
    for (const tier of tiers) {
      taken.push(tier)
      at = applyTier(tier, at)
    }
  }
}

describe('AdaptiveQuality', () => {
  it('halves the AO resolution first in a 3D scene', () => {
    expect(feed(new AdaptiveQuality(), 200, 0.05, 0.004, SCENE_3D)).toEqual([
      { kind: 'aoResolution', resolution: 'half' },
    ])
  })

  it('walks the whole ladder one tier at a time in order', () => {
    expect(walk(SCENE_3D)).toEqual([
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
    ])
  })

  it('walks only MSAA and the render scale in a 2D scene', () => {
    expect(walk(SCENE_2D).map((t) => t.kind)).toEqual([
      'msaa',
      'msaa',
      'scale',
      'scale',
      'scale',
      'scale',
    ])
  })

  it('skips the 2x tier on a backend with only 1 or 4 samples', () => {
    const msaa = walk({ ...SCENE_2D, webgpu: true }).filter(
      (t) => t.kind === 'msaa',
    )
    expect(msaa).toEqual([{ kind: 'msaa', samples: 1 }])
  })

  it('skips tiers the settings are already below', () => {
    const taken = walk({
      ...SCENE_3D,
      samples: 1,
      aoPreset: 'low',
      shadows: false,
    })
    expect(taken.map((t) => t.kind)).not.toContain('msaa')
    expect(taken.map((t) => t.kind)).not.toContain('aoPreset')
    expect(taken.map((t) => t.kind)).not.toContain('shadowSoftness')
    expect(taken.map((t) => t.kind)).not.toContain('shadows')
  })

  it('leaves a pinned setting alone and lowers the others', () => {
    const taken = walk({ ...SCENE_3D, pinned: ['msaa', 'scale'] })
    const kinds = taken.map((t) => t.kind)
    expect(kinds).not.toContain('msaa')
    expect(kinds).not.toContain('scale')
    expect(kinds).toContain('aoResolution')
    expect(kinds).toContain('shadows')
  })

  it('treats the AO preset pin as covering the AO off tier too', () => {
    const kinds = walk({ ...SCENE_3D, pinned: ['aoPreset'] }).map((t) => t.kind)
    expect(kinds).not.toContain('aoPreset')
    expect(kinds).not.toContain('ao')
    expect(kinds).toContain('aoResolution')
  })

  it('has nothing to lower when every group is pinned', () => {
    const a = new AdaptiveQuality()
    const all = [
      'msaa',
      'scale',
      'aoPreset',
      'aoResolution',
      'shadows',
    ] as const
    expect(feed(a, 400, 0.05, 0.002, { ...SCENE_3D, pinned: all })).toBeNull()
  })

  it('takes half of the tiers left when the frame is far over budget', () => {
    const a = new AdaptiveQuality()
    expect(feed(a, 100, 0.09, 0.002, SCENE_3D)).toEqual([
      { kind: 'aoResolution', resolution: 'half' },
      { kind: 'msaa', samples: 2 },
      { kind: 'aoPreset', preset: 'low' },
      { kind: 'msaa', samples: 1 },
      { kind: 'shadowSoftness', taps: 4 },
      { kind: 'scale', scale: 0.85 },
    ])
  })

  it('returns nothing once every tier is taken', () => {
    const bottom: QualitySnapshot = {
      ...SCENE_3D,
      samples: 1,
      scale: 0.5,
      ao: false,
      shadows: false,
    }
    expect(feed(new AdaptiveQuality(), 200, 0.09, 0.002, bottom)).toBeNull()
  })

  it('leaves slow frames alone when the CPU is the cost', () => {
    expect(feed(new AdaptiveQuality(), 200, 0.06, 0.05, SCENE_3D)).toBeNull()
  })

  it('leaves a healthy frame rate alone', () => {
    expect(feed(new AdaptiveQuality(), 400, 1 / 60, 0.002, SCENE_3D)).toBeNull()
  })

  it('does not count a frame cap as slow', () => {
    expect(
      feed(new AdaptiveQuality(), 200, 1 / 30, 0.002, {
        ...SCENE_3D,
        maxFps: 30,
      }),
    ).toBeNull()
  })

  it('ignores stalls and settles after a change', () => {
    const a = new AdaptiveQuality()
    expect(feed(a, 200, 1, 0.004, SCENE_2D)).toBeNull()
    expect(feed(a, 100, 0.06, 0.004, SCENE_2D)).toEqual([
      { kind: 'msaa', samples: 2 },
    ])
    // The caller applied it. The next decision waits for the target to settle
    // and then a full window, 2.5 seconds in all.
    const next = { ...SCENE_2D, samples: 2 }
    expect(feed(a, 40, 0.06, 0.004, next)).toBeNull()
    expect(feed(a, 10, 0.06, 0.004, next)).toEqual([
      { kind: 'msaa', samples: 1 },
    ])
  })

  it('decides after the same time at a low frame rate as at a high one', () => {
    // 2.5 seconds is 50 frames at 20 fps, where a frame count of 150 would
    // take 7.5 seconds.
    const a = new AdaptiveQuality()
    expect(feed(a, 49, 0.05, 0.004, SCENE_2D)).toBeNull()
    expect(feed(a, 1, 0.05, 0.004, SCENE_2D)).toEqual([
      { kind: 'msaa', samples: 2 },
    ])
  })
})
