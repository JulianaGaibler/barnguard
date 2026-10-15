import { describe, expect, it } from 'vitest'
import { createPathData, parsePathProp, parseProp } from './props'

const lin = { i: { x: [1], y: [1] }, o: { x: [0], y: [0] } }

function sampled(prop: ReturnType<typeof parseProp>, frame: number): number[] {
  const out = new Float64Array(prop.dims)
  prop.sample(frame, out)
  return Array.from(out)
}

describe('ValueProp', () => {
  it('interpolates, clamps outside the range, and reads a static value', () => {
    const p = parseProp(
      {
        a: 1,
        k: [
          { t: 10, s: [0], ...lin },
          { t: 20, s: [100] },
        ],
      },
      1,
    )
    expect(p.get(5)).toBe(0)
    expect(p.get(15)).toBeCloseTo(50, 6)
    expect(p.get(99)).toBe(100)
    const s = parseProp({ a: 0, k: 42 }, 1)
    expect(s.isStatic).toBe(true)
    expect(s.get(1000)).toBe(42)
  })

  it('holds a hold keyframe until the next one', () => {
    const p = parseProp(
      {
        a: 1,
        k: [
          { t: 0, s: [7], h: 1 },
          { t: 10, s: [9] },
        ],
      },
      1,
    )
    expect(p.get(9.9)).toBe(7)
    expect(p.get(10)).toBe(9)
  })

  it('upgrades legacy end values and scalar start values', () => {
    const p = parseProp(
      { a: 1, k: [{ t: 0, s: 0, e: 10, ...lin }, { t: 10 }] },
      1,
    )
    expect(p.get(5)).toBeCloseTo(5, 6)
    expect(p.get(10)).toBe(10)
  })

  it('applies a cubic easing, and a separate easing per axis', () => {
    const eased = parseProp(
      {
        a: 1,
        k: [
          { t: 0, s: [0], i: { x: [0.58], y: [1] }, o: { x: [0.42], y: [0] } },
          { t: 10, s: [100] },
        ],
      },
      1,
    )
    expect(eased.get(2)).toBeLessThan(20)
    expect(eased.get(5)).toBeCloseTo(50, 3)
    const axes = parseProp(
      {
        a: 1,
        k: [
          {
            t: 0,
            s: [0, 0],
            i: { x: [0.9, 0.1], y: [1, 1] },
            o: { x: [0.1, 0.9], y: [0, 0] },
          },
          { t: 10, s: [100, 100] },
        ],
      },
      2,
    )
    const [x, y] = sampled(axes, 3)
    expect(x).not.toBeCloseTo(y, 1)
  })

  it('moves along a spatial curve by arc length', () => {
    // A straight spatial segment with handles along the line behaves linearly.
    const straight = parseProp(
      {
        a: 1,
        k: [
          { t: 0, s: [0, 0], to: [10, 0], ti: [-10, 0], ...lin },
          { t: 10, s: [30, 0] },
        ],
      },
      2,
    )
    expect(sampled(straight, 5)[0]).toBeCloseTo(15, 0)
    // A bent segment passes through off-line points.
    const bent = parseProp(
      {
        a: 1,
        k: [
          { t: 0, s: [0, 0], to: [0, 50], ti: [0, 50], ...lin },
          { t: 10, s: [100, 0] },
        ],
      },
      2,
    )
    const [bx, by] = sampled(bent, 5)
    expect(by).toBeGreaterThan(10)
    expect(bx).toBeCloseTo(50, 0)
  })

  it('scales values and keeps the slot id', () => {
    const p = parseProp(
      { a: 0, k: [255, 128, 0, 255], sid: 'tint' },
      4,
      undefined,
      1 / 255,
    )
    expect(p.slotId).toBe('tint')
    expect(sampled(p, 0)[0]).toBeCloseTo(1, 6)
    expect(sampled(p, 0)[1]).toBeCloseTo(128 / 255, 6)
  })

  it('does not allocate while sampling', () => {
    const p = parseProp(
      {
        a: 1,
        k: [
          { t: 0, s: [0, 0] },
          { t: 100, s: [1, 1] },
        ],
      },
      2,
    )
    const out = new Float64Array(2)
    for (let f = 0; f < 5; f++) p.sample(f, out)
    const before = (performance as { memory?: { usedJSHeapSize: number } })
      .memory?.usedJSHeapSize
    for (let f = 0; f < 20000; f++) p.sample(f % 100, out)
    const after = (performance as { memory?: { usedJSHeapSize: number } })
      .memory?.usedJSHeapSize
    if (before !== undefined && after !== undefined) {
      expect(after - before).toBeLessThan(1_000_000)
    }
    expect(out[0]).toBeGreaterThan(0)
  })
})

describe('PathProp', () => {
  const shape = (x: number) => ({
    c: true,
    v: [
      [0, 0],
      [x, 0],
      [x, 10],
    ],
    i: [
      [0, 0],
      [0, 0],
      [0, 0],
    ],
    o: [
      [0, 0],
      [0, 0],
      [0, 0],
    ],
  })

  it('morphs between shapes with the same vertex count', () => {
    const p = parsePathProp({
      a: 1,
      k: [
        { t: 0, s: [shape(10)], ...lin },
        { t: 10, s: [shape(30)] },
      ],
    })
    const out = createPathData()
    p.sample(5, out)
    expect(out.count).toBe(3)
    expect(out.closed).toBe(true)
    expect(out.v[2]).toBeCloseTo(20, 6)
  })

  it('holds the earlier shape when vertex counts differ', () => {
    const four = {
      ...shape(30),
      v: [
        [0, 0],
        [30, 0],
        [30, 10],
        [0, 10],
      ],
      i: Array(4).fill([0, 0]),
      o: Array(4).fill([0, 0]),
    }
    const p = parsePathProp({
      a: 1,
      k: [
        { t: 0, s: [shape(10)], ...lin },
        { t: 10, s: [four] },
      ],
    })
    const out = createPathData()
    p.sample(5, out)
    expect(out.count).toBe(3)
    expect(out.v[2]).toBe(10)
    p.sample(10, out)
    expect(out.count).toBe(4)
  })
})
