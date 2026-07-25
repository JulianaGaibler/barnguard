import { describe, it, expect } from 'vitest'
import { BoxConstraints } from '../constraints'
import { Box, SizedBox } from './Box'
import { Row } from './Flex'
import { Stack } from './Stack'
import { Scaffold } from './Scaffold'
import { ShapeNode } from '../../nodes/ShapeNode'

const loose = (w: number, h: number) => BoxConstraints.loose(w, h)
const tight = (w: number, h: number) => BoxConstraints.tight(w, h)

describe('Stack', () => {
  it('shrink-wraps to the largest child and aligns each child', () => {
    const back = new SizedBox({ width: 200, height: 100 })
    const badge = new SizedBox({ width: 40, height: 40 })
    const stack = new Stack({
      alignX: 'end',
      alignY: 'start',
      children: [back, badge],
    })

    const size = stack.measure(loose(1000, 1000))
    expect(size).toEqual({ w: 200, h: 100 })

    stack.arrange(0, 0, 200, 100)
    expect([back.transform.x, back.transform.y]).toEqual([0, 0])
    expect([badge.transform.x, badge.transform.y]).toEqual([160, 0]) // right-aligned
  })

  it('expand fit fills bounded constraints', () => {
    const stack = new Stack({
      fit: 'expand',
      children: [new SizedBox({ width: 20, height: 20 })],
    })
    const size = stack.measure(tight(300, 150))
    expect(size).toEqual({ w: 300, h: 150 })
  })
})

describe('Scaffold', () => {
  it('sizes header/footer to content and expands the middle', () => {
    const header = new SizedBox({ width: 300, height: 50 })
    const footer = new SizedBox({ width: 300, height: 30 })
    const content = new Box() // fills the space between
    const scaffold = new Scaffold({ header, content, footer })

    const size = scaffold.measure(tight(400, 200))
    expect(size).toEqual({ w: 400, h: 200 })

    scaffold.arrange(0, 0, 400, 200)
    expect(header.transform.y).toBe(0)
    // content takes 200 - 50 - 30 = 120, so the footer starts at 50 + 120 = 170.
    expect(footer.transform.y).toBe(170)
  })
})

describe('ShapeNode in a layout', () => {
  it('reports its intrinsic size and centers its origin in the assigned box', () => {
    const dot = new ShapeNode({ geometry: { kind: 'circle', radius: 20 } })
    const box = new SizedBox({ width: 100, height: 40 })
    const row = new Row({ children: [dot, box] })

    const size = row.measure(loose(1000, 1000))
    expect(size).toEqual({ w: 140, h: 40 }) // 40 (diameter) + 100

    row.arrange(0, 0, 140, 40)
    // The circle's origin sits at the center of its 40×40 slot.
    expect([dot.transform.x, dot.transform.y]).toEqual([20, 20])
    expect(box.transform.x).toBe(40)
  })
})
