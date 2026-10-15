import { describe, it, expect, vi } from 'vitest'
import { TextNode } from './TextNode'
import { paintCalls } from '../render/picture/paintCalls'
import { BoxConstraints } from '../layout/constraints'
import type { GfxTextStyle } from '../render/gfx/Gfx2D'

// `measureText` depends on a real Canvas2D text engine, unavailable under
// happy-dom. Stub it with a deterministic width (10px/char) so `measure()`
// tests can assert on layout math rather than font shaping.
// A 10px-per-character monospace model, with vertical metrics that make a
// `Npx` font exactly `N` tall so the block arithmetic below reads directly.
vi.mock('../render/gfx/rasterizeLabel', () => ({
  measureText: (text: string) => ({
    localW: text.length * 10,
    localH: 0,
    advance: text.length * 10,
    ascent: 0,
    descent: 0,
    anchorOffsetX: 0,
    anchorOffsetY: 0,
  }),
  fontMetrics: (font: string) => {
    const size = Number(/(\d+(?:\.\d+)?)px/.exec(font)?.[1] ?? 10)
    return {
      ascent: size * 0.8,
      descent: size * 0.2,
      capHeight: size * 0.7,
      lineHeight: size,
    }
  },
}))

interface FillTextCall {
  text: string
  x: number
  y: number
  font: string
  align: string
  baseline: string
  color: string
}

/** The `fillText` calls the node paints, at `scale` camera zoom. */
function paint(node: TextNode, zoom = 1): FillTextCall[] {
  return paintCalls(node, { screenScale: 1 / zoom })
    .filter((c) => c.name === 'fillText')
    .map((c) => {
      const [text, x, y, style] = c.args as [
        string,
        number,
        number,
        GfxTextStyle,
      ]
      return {
        text,
        x,
        y,
        font: style.font ?? '',
        align: style.align ?? '',
        baseline: style.baseline ?? '',
        color: style.color ?? '',
      }
    })
}

describe('TextNode', () => {
  it('draws the text with the composed font string', () => {
    const node = new TextNode({
      text: 'hello',
      fontFamily: 'sans-serif',
      fontWeight: 700,
      fontSize: 16,
      color: '#123',
    })
    const calls = paint(node, 1)
    expect(calls).toHaveLength(1)
    expect(calls[0].text).toBe('hello')
    expect(calls[0].font).toBe('700 16px sans-serif')
    expect(calls[0].color).toBe('#123')
  })

  it('scales screen-space font size by 1/camera-scale (constant on-screen size)', () => {
    const node = new TextNode({ text: 'hi', fontSize: 20, sizeSpace: 'screen' })
    const calls = paint(node, 2) // strokeSpaceScale() = 0.5
    expect(calls[0].font).toBe('normal 10px sans-serif')
  })

  it('leaves world-space font size unscaled', () => {
    const node = new TextNode({ text: 'hi', fontSize: 20, sizeSpace: 'world' })
    const calls = paint(node, 2)
    expect(calls[0].font).toBe('normal 20px sans-serif')
  })

  it('does not draw an empty string', () => {
    const node = new TextNode({ text: '' })
    const calls = paint(node, 1)
    expect(calls).toHaveLength(0)
  })

  describe('multi-line', () => {
    it('draws one fillText call per line, on its own alphabetic baseline', () => {
      const node = new TextNode({
        text: 'one\ntwo\nthree',
        fontSize: 10,
        baseline: 'top',
      })
      const calls = paint(node, 1)
      expect(calls.map((c) => c.text)).toEqual(['one', 'two', 'three'])
      expect(calls.every((c) => c.baseline === 'alphabetic')).toBe(true)
    })

    it("spaces lines by the font's line height, scaled by lineHeight", () => {
      const node = new TextNode({
        text: 'a\nb',
        fontSize: 10,
        baseline: 'top',
        y: 0,
      })
      const calls = paint(node, 1)
      // The stub makes a 10px font 10 tall with an ascent of 8, so the first
      // baseline sits 8 below the block top and the second a line after it.
      expect(calls[0].y).toBeCloseTo(8)
      expect(calls[1].y).toBeCloseTo(20)
    })

    it('honors a custom lineHeight', () => {
      const node = new TextNode({
        text: 'a\nb',
        fontSize: 10,
        baseline: 'top',
        lineHeight: 2,
        y: 0,
      })
      const calls = paint(node, 1)
      expect(calls[1].y).toBeCloseTo(28) // ascent 8 + 10 * 2
    })

    it('anchors the whole block on y for baseline "middle"', () => {
      const node = new TextNode({
        text: 'a\nb',
        fontSize: 10,
        baseline: 'middle',
        y: 100,
      })
      const calls = paint(node, 1)
      // Two lines span one gap plus one line box, 12 + 10 = 22, so the top is
      // 100 - 11 and the first baseline an ascent below that.
      expect(calls[0].y).toBeCloseTo(97)
      expect(calls[1].y).toBeCloseTo(109)
    })

    it('anchors the whole block above y for baseline "bottom"', () => {
      const node = new TextNode({
        text: 'a\nb',
        fontSize: 10,
        baseline: 'bottom',
        y: 100,
      })
      const calls = paint(node, 1)
      expect(calls[0].y).toBeCloseTo(86) // top 78, plus an ascent of 8
      expect(calls[1].y).toBeCloseTo(98)
    })
  })

  describe('measure', () => {
    it('measures a single line as one line box, with no trailing leading', () => {
      const node = new TextNode({ text: 'hi', fontSize: 10 })
      const size = node.measure(BoxConstraints.loose(Infinity, Infinity))
      expect(size.h).toBeCloseTo(10) // ascent 8 + descent 2
      expect(size.w).toBe(20) // stubbed measureText: 2 chars * 10
    })

    it('measures multi-line width as the widest line, height as the gaps plus one box', () => {
      const node = new TextNode({ text: 'one\ntwo\nthree', fontSize: 10 })
      const size = node.measure(BoxConstraints.loose(Infinity, Infinity))
      expect(size.h).toBeCloseTo(34) // 2 gaps of 12, plus a 10 line box
      expect(size.w).toBe(50) // 'three' is the widest line, 5 chars * 10
    })

    it('clamps the measured size to the given constraints', () => {
      const node = new TextNode({ text: 'hello world', fontSize: 40 })
      const size = node.measure(BoxConstraints.tight(5, 5))
      expect(size).toEqual({ w: 5, h: 5 })
    })

    it('returns the same object identity as measuredSize', () => {
      const node = new TextNode({ text: 'hi' })
      const size = node.measure(BoxConstraints.loose(Infinity, Infinity))
      expect(size).toBe(node.measuredSize)
    })
  })

  describe('arrange', () => {
    it('sets transform to the box origin and anchors align=left/baseline=top at the box corner', () => {
      const node = new TextNode({ text: 'hi', align: 'left', baseline: 'top' })
      node.arrange(10, 20, 100, 50)
      expect(node.transform.x).toBe(10)
      expect(node.transform.y).toBe(20)
      expect(node.x).toBe(0)
      expect(node.y).toBe(0)
    })

    it('anchors align=center/baseline=middle at the box center', () => {
      const node = new TextNode({
        text: 'hi',
        align: 'center',
        baseline: 'middle',
      })
      node.arrange(10, 20, 100, 50)
      expect(node.x).toBe(50)
      expect(node.y).toBe(25)
    })

    it('anchors align=right/baseline=bottom at the box far corner', () => {
      const node = new TextNode({
        text: 'hi',
        align: 'right',
        baseline: 'bottom',
      })
      node.arrange(10, 20, 100, 50)
      expect(node.x).toBe(100)
      expect(node.y).toBe(50)
    })

    it('writes boundsOverride for culling/hit-testing', () => {
      const node = new TextNode({ text: 'hi' })
      node.arrange(10, 20, 100, 50)
      expect(node.boundsOverride).toEqual({
        x: 0,
        y: 0,
        width: 100,
        height: 50,
      })
    })
  })
})
