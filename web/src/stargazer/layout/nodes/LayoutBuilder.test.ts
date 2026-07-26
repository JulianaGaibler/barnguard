import { describe, it, expect, vi } from 'vitest'
import { BoxConstraints } from '../constraints'
import type { Rect } from '../../math/Rect'
import { SizedBox } from './Box'
import { Column, Expanded } from './Flex'
import { LayoutBuilder } from './LayoutBuilder'

const loose = (w: number, h: number) => BoxConstraints.loose(w, h)
const tight = (w: number, h: number) => BoxConstraints.tight(w, h)

describe('LayoutBuilder', () => {
  it('fills a tight box and measures to 0 under a loose one', () => {
    const lb = new LayoutBuilder()
    expect(lb.measure(tight(400, 300))).toEqual({ w: 400, h: 300 })
    expect(lb.measure(loose(400, 300))).toEqual({ w: 0, h: 0 })
  })

  it('honours fixed width/height under a loose box', () => {
    const lb = new LayoutBuilder({ width: 120, height: 48 })
    expect(lb.measure(loose(400, 300))).toEqual({ w: 120, h: 48 })
  })

  it('warns when an axis is completely unconstrained', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const lb = new LayoutBuilder({ id: 'field' })
    // Default constraints: min 0, max Infinity on both axes.
    expect(lb.measure(new BoxConstraints())).toEqual({ w: 0, h: 0 })
    expect(warn).toHaveBeenCalledTimes(1) // guarded so it warns once, not every pass
    warn.mockRestore()
  })

  it('reports a world rect that includes ancestor offsets', () => {
    const band = new SizedBox({ width: 10, height: 100 })
    let got: Rect | null = null
    const lb = new LayoutBuilder({ onLayout: (r) => (got = { ...r }) })
    const col = new Column({
      crossAxisAlign: 'stretch',
      children: [band, new Expanded({ child: lb })],
    })
    col.measure(tight(400, 500))
    col.arrange(30, 40, 400, 500)
    // Band takes 100 of the height at the top; the builder fills the rest,
    // offset by the column origin (30, 40) plus the band (100).
    expect(got).toEqual({ x: 30, y: 140, width: 400, height: 400 })
    expect(lb.contentRect).toMatchObject({
      x: 30,
      y: 140,
      width: 400,
      height: 400,
    })
  })

  it('does not measure or arrange its own children', () => {
    const child = new SizedBox({ width: 20, height: 20 })
    const measure = vi.spyOn(child, 'measure')
    const arrange = vi.spyOn(child, 'arrange')
    const lb = new LayoutBuilder()
    lb.add(child)
    lb.measure(tight(200, 200))
    lb.arrange(0, 0, 200, 200)
    expect(measure).not.toHaveBeenCalled()
    expect(arrange).not.toHaveBeenCalled()
    expect([child.transform.x, child.transform.y]).toEqual([0, 0])
  })
})
