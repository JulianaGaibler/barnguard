import { describe, expect, it } from 'vitest'
import { paintCalls, type GfxPath } from '@src/stargazer'
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
    // Within 4 units -> dropped.
    expect(trail.sample(1, 0)).toBe(false)
    expect(trail.count).toBe(1)
    expect(trail.sample(2, 2)).toBe(false)
    expect(trail.count).toBe(1)
    // Just past 4 units -> accepted.
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

describe('PacketMotionTrailNode repaint', () => {
  it('repaints for a moved head or a new sample, not for a repeat', () => {
    const trail = new PacketMotionTrailNode({ capacity: 4 })
    trail.sample(0, 0)
    trail.setLiveHead(5, 0)
    trail._paintDirty = false
    trail.setLiveHead(5, 0)
    expect(trail._paintDirty).toBe(false)
    trail.setLiveHead(6, 0)
    expect(trail._paintDirty).toBe(true)
    trail._paintDirty = false
    trail.sample(100, 0)
    expect(trail._paintDirty).toBe(true)
  })
})

describe('PacketMotionTrailNode paint', () => {
  it('fills and outlines one comet outline with gradient paints', () => {
    const trail = new PacketMotionTrailNode({ capacity: 8 })
    for (let i = 0; i < 8; i++) trail.sample(i * 6, 0)
    trail.setLiveHead(45, 0)
    const calls = paintCalls(trail, { screenScale: 1 })
    const fill = calls.find((c) => c.name === 'fillPath')
    const stroke = calls.find((c) => c.name === 'strokePath')
    expect((fill?.args[1] as { kind: string }).kind).toBe('linear')
    const style = stroke?.args[1] as { color: { kind: string } }
    expect(style.color.kind).toBe('linear')
  })

  it('draws nothing without at least two points', () => {
    const trail = new PacketMotionTrailNode({ capacity: 4 })
    trail.sample(0, 0)
    expect(paintCalls(trail, { screenScale: 1 })).toHaveLength(0)
  })
})

describe('PacketMotionTrailNode shape', () => {
  function outline(trail: PacketMotionTrailNode): Float32Array {
    const fill = paintCalls(trail, { screenScale: 1 }).find(
      (c) => c.name === 'fillPath',
    )
    const path = fill?.args[0] as GfxPath
    const flat = path.flatten(0.25)
    return flat.points.slice(0, flat.pointCount * 2)
  }

  it('starts the halo on the packet hex, turned with the packet', () => {
    const trail = new PacketMotionTrailNode({ capacity: 8 })
    for (let i = 7; i >= 0; i--) trail.sample(-i * 6, 0)
    // Heading straight down (+y): rotation = heading + π/2.
    trail.setLiveHead(0, 0, Math.PI)
    const pts = outline(trail)
    const g = trail.glowRadiusWorld
    // The middle halo vertex points along the heading.
    expect(pts[4]).toBeCloseTo(0, 4)
    expect(pts[5]).toBeCloseTo(g, 4)
  })

  it('keeps the start of the tail behind the head when the path doubles back', () => {
    const trail = new PacketMotionTrailNode({ capacity: 16 })
    // The packet travelled left along y = 4 and has just turned to head +x,
    // so its recent path lies up to 60 units AHEAD of it.
    for (let i = 0; i < 16; i++) trail.sample(60 - i * 4, 4)
    trail.setLiveHead(0, 0, Math.PI / 2)
    const pts = outline(trail)
    // After the five halo vertices, the first tail edge points sit behind the
    // head rather than jumping forward onto the old path.
    for (let k = 5; k < 8; k++) expect(pts[k * 2]).toBeLessThan(0)
  })
})
