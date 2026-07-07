import { describe, expect, it } from 'vitest'
import { PacketMotionTrailNode } from './PacketMotionTrailNode'

describe('PacketMotionTrailNode', () => {
  it('distance filter drops samples closer than the threshold', () => {
    const trail = new PacketMotionTrailNode({
      capacity: 8,
      minSampleDistWorld: 4,
    })
    expect(trail.count).toBe(0)
    expect(trail.sample(0, 0)).toBe(true)
    expect(trail.count).toBe(1)
    // Within 4 units → dropped.
    expect(trail.sample(1, 0)).toBe(false)
    expect(trail.count).toBe(1)
    expect(trail.sample(2, 2)).toBe(false)
    expect(trail.count).toBe(1)
    // Just past 4 units → accepted.
    expect(trail.sample(5, 0)).toBe(true)
    expect(trail.count).toBe(2)
  })

  it('ring buffer wraps at capacity, retaining the newest N samples', () => {
    const trail = new PacketMotionTrailNode({
      capacity: 4,
      minSampleDistWorld: 1,
    })
    // Push 6 samples spaced 10 units apart along +x.
    for (let i = 0; i < 6; i++) trail.sample(i * 10, 0)
    expect(trail.count).toBe(4)
    // Introspect via `setLiveHead` roundtrip, the trail exposes count only,
    // so this test just asserts the invariant that count caps at capacity.
    // Push one more, still capped.
    trail.sample(60, 0)
    expect(trail.count).toBe(4)
  })

  it('clear() wipes both the ring buffer and the live head', () => {
    const trail = new PacketMotionTrailNode({
      capacity: 4,
      minSampleDistWorld: 1,
    })
    trail.sample(0, 0)
    trail.sample(10, 0)
    trail.setLiveHead(15, 0)
    expect(trail.count).toBe(2)
    expect(Number.isFinite(trail.liveHeadX)).toBe(true)
    trail.clear()
    expect(trail.count).toBe(0)
    expect(Number.isFinite(trail.liveHeadX)).toBe(false)
    expect(Number.isFinite(trail.liveHeadY)).toBe(false)
  })

  it('setLiveHead can be called before any sample() (pre-first-frame safe)', () => {
    const trail = new PacketMotionTrailNode({ capacity: 4 })
    trail.setLiveHead(1, 2)
    expect(trail.liveHeadX).toBe(1)
    expect(trail.liveHeadY).toBe(2)
    expect(trail.count).toBe(0)
  })
})
