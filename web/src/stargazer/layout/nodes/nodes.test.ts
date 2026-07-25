import { describe, it, expect } from 'vitest'
import { BoxConstraints, edgeInsets } from '../constraints'
import { SceneNode } from '../../scene/SceneNode'
import { Box, SizedBox, Padding, Center, Align } from './Box'
import { Row, Column, Expanded, Spacer } from './Flex'

const loose = (w: number, h: number) => BoxConstraints.loose(w, h)
const tight = (w: number, h: number) => BoxConstraints.tight(w, h)

describe('freeform children', () => {
  it('a Row lays out measurable children and leaves a plain node alone', () => {
    const a = new SizedBox({ width: 100, height: 40 })
    const freeform = new SceneNode('freeform')
    freeform.transform.x = 7
    freeform.transform.y = 9
    const b = new SizedBox({ width: 50, height: 40 })
    const row = new Row({ children: [a, b] })
    row.add(freeform) // a non-measurable node joins via add(), not the typed children

    const size = row.measure(loose(1000, 1000))
    expect(size).toEqual({ w: 150, h: 40 }) // only the two boxes count

    row.arrange(0, 0, size.w, size.h)
    expect(a.transform.x).toBe(0)
    expect(b.transform.x).toBe(100) // right after `a`, freeform contributes nothing
    expect([freeform.transform.x, freeform.transform.y]).toEqual([7, 9]) // untouched
  })
})

describe('Column', () => {
  it('stacks children top to bottom with a gap and shrink-wraps', () => {
    const a = new SizedBox({ width: 100, height: 40 })
    const b = new SizedBox({ width: 200, height: 60 })
    const col = new Column({ gap: 10, children: [a, b] })

    const size = col.measure(loose(1000, 1000))
    expect(size).toEqual({ w: 200, h: 110 }) // widest child; 40 + 10 + 60

    col.arrange(0, 0, size.w, size.h)
    expect([a.transform.x, a.transform.y]).toEqual([0, 0])
    expect([b.transform.x, b.transform.y]).toEqual([0, 50]) // 40 + 10 gap
  })

  it('centers on the cross axis', () => {
    const a = new SizedBox({ width: 100, height: 40 })
    const col = new Column({ crossAxisAlign: 'center', children: [a] })
    col.measure(loose(400, 400))
    col.arrange(0, 0, 400, 40)
    expect(a.transform.x).toBe(150) // (400 - 100) / 2
  })
})

describe('Row + Expanded', () => {
  it('gives leftover main-axis space to the expanded child', () => {
    const fixed = new SizedBox({ width: 100, height: 50 })
    const grow = new Expanded({ child: new Box() })
    const row = new Row({ children: [fixed, grow] })

    const size = row.measure(tight(400, 50))
    expect(size.w).toBe(400)

    row.arrange(0, 0, 400, 50)
    expect(fixed.transform.x).toBe(0)
    expect(grow.transform.x).toBe(100) // after the 100-wide fixed child
    // The expanded child fills the remaining 300.
    expect(grow.measuredSize.w).toBe(300)
  })

  it('splits space between two spacers to right-align a trailing item', () => {
    const title = new SizedBox({ width: 80, height: 20 })
    const close = new SizedBox({ width: 20, height: 20 })
    const row = new Row({ children: [title, new Spacer(), close] })
    row.measure(tight(300, 20))
    row.arrange(0, 0, 300, 20)
    expect(title.transform.x).toBe(0)
    expect(close.transform.x).toBe(280) // pushed to the right edge
  })
})

describe('Box', () => {
  it('shrink-wraps to child plus padding and insets the child', () => {
    const child = new SizedBox({ width: 100, height: 40 })
    const box = new Box({ padding: edgeInsets(10), child })
    const size = box.measure(loose(1000, 1000))
    expect(size).toEqual({ w: 120, h: 60 }) // 100 + 20, 40 + 20
    box.arrange(0, 0, size.w, size.h)
    expect([child.transform.x, child.transform.y]).toEqual([10, 10])
  })

  it('fills a fixed size and stretches its child to the interior', () => {
    const child = new Box()
    const box = new Box({
      width: 300,
      height: 200,
      padding: edgeInsets(20),
      child,
    })
    const size = box.measure(loose(1000, 1000))
    expect(size).toEqual({ w: 300, h: 200 })
    box.arrange(0, 0, 300, 200)
    expect(child.measuredSize).toEqual({ w: 260, h: 160 }) // interior
  })
})

describe('Padding', () => {
  it('is a Box with only insets', () => {
    const child = new SizedBox({ width: 50, height: 50 })
    const pad = new Padding({ insets: edgeInsets(8, 16), child })
    const size = pad.measure(loose(1000, 1000))
    expect(size).toEqual({ w: 50 + 32, h: 50 + 16 })
  })
})

describe('Center / Align', () => {
  it('Center fills the offered space and centers the child', () => {
    const child = new SizedBox({ width: 100, height: 100 })
    const center = new Center({ child })
    center.measure(tight(400, 300))
    center.arrange(0, 0, 400, 300)
    expect([child.transform.x, child.transform.y]).toEqual([150, 100])
  })

  it('Align places the child at a corner', () => {
    const child = new SizedBox({ width: 40, height: 40 })
    const align = new Align({ alignX: 'end', alignY: 'start', child })
    align.measure(tight(400, 300))
    align.arrange(0, 0, 400, 300)
    expect([child.transform.x, child.transform.y]).toEqual([360, 0])
  })

  it('Align stretch fills the axis', () => {
    const child = new Box()
    const align = new Align({ alignX: 'stretch', alignY: 'center', child })
    align.measure(tight(400, 300))
    align.arrange(0, 0, 400, 300)
    expect(child.measuredSize.w).toBe(400)
  })
})
