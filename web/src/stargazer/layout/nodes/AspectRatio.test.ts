import { describe, it, expect } from 'vitest'
import { BoxConstraints } from '../constraints'
import { SizedBox } from './Box'
import { AspectRatio } from './AspectRatio'

const loose = (w: number, h: number) => BoxConstraints.loose(w, h)
const tight = (w: number, h: number) => BoxConstraints.tight(w, h)

describe('AspectRatio', () => {
  it('fits a square in a wide loose box and centers it', () => {
    const child = new SizedBox({ width: 10, height: 10 })
    const ar = new AspectRatio({ ratio: 1, child })
    expect(ar.measure(loose(400, 300))).toEqual({ w: 300, h: 300 })
    ar.arrange(0, 0, 400, 300)
    expect([child.transform.x, child.transform.y]).toEqual([50, 0]) // (400-300)/2, (300-300)/2
  })

  it('fits a 2:1 box bounded by width', () => {
    const child = new SizedBox({ width: 10, height: 10 })
    const ar = new AspectRatio({ ratio: 2, child })
    expect(ar.measure(loose(400, 300))).toEqual({ w: 400, h: 200 })
  })

  it('corner-pins with alignX/alignY start', () => {
    const child = new SizedBox({ width: 10, height: 10 })
    const ar = new AspectRatio({
      ratio: 1,
      child,
      alignX: 'start',
      alignY: 'start',
    })
    ar.arrange(0, 0, 400, 300)
    expect([child.transform.x, child.transform.y]).toEqual([0, 0])
  })

  it('throws when both axes are unbounded', () => {
    const ar = new AspectRatio({
      ratio: 1,
      child: new SizedBox({ width: 1, height: 1 }),
    })
    expect(() => ar.measure(new BoxConstraints())).toThrow(/no bounded axis/)
  })

  it('honours a tight constraint while placing the child in the ratio box', () => {
    const child = new SizedBox({ width: 10, height: 10 })
    const ar = new AspectRatio({ ratio: 16 / 9, child })
    // Tight 400x400: the reported size must stay 400x400 (constraints win)...
    expect(ar.measure(tight(400, 400))).toEqual({ w: 400, h: 400 })
    // ...while the child sits in the 400x225 ratio box, vertically centered.
    ar.arrange(0, 0, 400, 400)
    expect(child.transform.x).toBe(0)
    expect(child.transform.y).toBeCloseTo((400 - 225) / 2)
  })
})
