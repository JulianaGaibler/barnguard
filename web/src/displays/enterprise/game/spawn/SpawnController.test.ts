import { describe, expect, it } from 'vitest'
import type { BitmapMask, Vec2 } from '@src/stargazer'
import { TUNING } from '../data/tuning'
import {
  pickTier,
  SessionDifficulty,
  SpawnController,
  tierOfSpeed,
  tierShares,
  tierSpeed,
  type SpeedTier,
} from './SpawnController'

/** Deterministic `Math.random` stand-in (mulberry32). */
function seeded(seed: number): () => number {
  let a = seed
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function draws(
  score: number,
  board: readonly SpeedTier[],
  count: number,
): Record<SpeedTier, number> {
  const difficulty = new SessionDifficulty(seeded(7))
  const speeds = board.map(tierSpeed)
  const shares: Record<SpeedTier, number> = { regular: 0, slow: 0, medium: 0 }
  for (let i = 0; i < count; i++) {
    shares[tierOfSpeed(difficulty.sampleTravelSpeed(score, speeds))]++
  }
  for (const tier of Object.keys(shares) as SpeedTier[]) shares[tier] /= count
  return shares
}

describe('tierShares', () => {
  const { slow, medium } = TUNING.difficulty

  it('locks slow below its unlock score and medium below its own', () => {
    expect(tierShares(slow.unlockScore - 1)).toEqual({
      regular: 1,
      slow: 0,
      medium: 0,
    })
    expect(tierShares(slow.unlockScore).slow).toBeCloseTo(slow.shareStart)
    expect(tierShares(medium.unlockScore - 1).medium).toBe(0)
    expect(tierShares(medium.unlockScore).medium).toBe(medium.share)
  })

  it('caps the slow share', () => {
    expect(tierShares(1000).slow).toBe(slow.shareCap)
  })

  it('sums to one', () => {
    const shares = tierShares(30)
    expect(shares.regular + shares.slow + shares.medium).toBeCloseTo(1)
  })
})

describe('SessionDifficulty', () => {
  it('spawns only regular packets before slow unlocks', () => {
    const shares = draws(TUNING.difficulty.slow.unlockScore - 1, [], 1000)
    expect(shares.regular).toBe(1)
  })

  it('spawns no medium packets before medium unlocks', () => {
    const shares = draws(TUNING.difficulty.medium.unlockScore - 1, [], 1000)
    expect(shares.medium).toBe(0)
  })

  it('follows the target shares on an empty board', () => {
    const score = 20
    const target = tierShares(score)
    const shares = draws(score, [], 10000)
    for (const tier of ['regular', 'slow', 'medium'] as const) {
      expect(Math.abs(shares[tier] - target[tier])).toBeLessThan(0.02)
    }
  })

  it('draws a tier less often while it crowds the board', () => {
    const score = 20
    const crowded = draws(score, ['slow', 'slow', 'slow', 'regular'], 10000)
    expect(crowded.slow).toBeLessThan(tierShares(score).slow - 0.1)
  })

  it('still picks a tier on a board of only slow and medium packets', () => {
    const shares = draws(20, ['slow', 'slow', 'medium', 'medium'], 1000)
    expect(shares.regular + shares.slow + shares.medium).toBeCloseTo(1)
    expect(shares.regular).toBeGreaterThan(tierShares(20).regular)
    // Half the board is medium against a 0.12 share, so its weight clamps to 0.
    expect(shares.medium).toBe(0)
  })
})

describe('pickTier', () => {
  it('falls back to regular when no tier has weight', () => {
    const none = { regular: 0, slow: 0, medium: 0 }
    expect(pickTier(none, ['slow'], 1.5, () => 0.5)).toBe('regular')
  })
})

describe('SpawnController', () => {
  /** Square land with `side` on each edge, centred on `centre`, in open sea. */
  function island(centre: Vec2, side: number): BitmapMask {
    const half = side / 2
    return {
      contains: (x: number, y: number, inset = 0) =>
        Math.abs(x - centre.x) <= half - inset &&
        Math.abs(y - centre.y) <= half - inset,
    } as BitmapMask
  }

  /** Runs one spawn slot and returns where it landed. */
  async function spawnOnce(mask: BitmapMask): Promise<Vec2 | null> {
    let spawned: Vec2 | null = null
    let waits = 0
    const controller = new SpawnController(
      {
        isPlaying: () => true,
        mask: () => mask,
        epicenter: () => null,
        activePackets: () => [],
        score: () => 0,
        spawnBounds: () => ({ x: 0, y: 0, width: 1000, height: 1000 }),
        spawnPacket: (at) => {
          spawned = at
          return null
        },
      },
      () => (waits++ === 0 ? Promise.resolve() : new Promise(() => {})),
    )
    controller.start()
    await Promise.resolve()
    await Promise.resolve()
    controller.stop()
    return spawned
  }

  it('finds the land in a view that is almost all sea', async () => {
    const centre = { x: 700, y: 300 }
    // 100 wu of land with the 45 wu border buffer leaves a 10 wu square.
    const at = await spawnOnce(island(centre, 100))
    expect(at).not.toBeNull()
    expect(Math.abs(at!.x - centre.x)).toBeLessThanOrEqual(5)
    expect(Math.abs(at!.y - centre.y)).toBeLessThanOrEqual(5)
  })
})
