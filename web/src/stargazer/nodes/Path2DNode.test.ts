import { describe, it, expect } from 'vitest'
import { Path2DNode } from './Path2DNode'
import { paintCalls } from '../render/picture/paintCalls'
import type { Rect } from '../math/Rect'
import type {
  GfxFill,
  GfxShadowStyle,
  GfxStrokeStyle,
} from '../render/gfx/Gfx2D'

interface Call {
  method: string
  args: unknown[]
}

/**
 * The drawing calls the node paints, at `screenScale` world units per CSS
 * pixel.
 */
function paint(node: Path2DNode, screenScale = 1): Call[] {
  return paintCalls(node, { screenScale }).map((c) => ({
    method: c.name,
    args: c.args,
  }))
}

describe('Path2DNode', () => {
  it('fills then strokes, with no shadow', () => {
    const path = new Path2D()
    const node = new Path2DNode({ path, fill: '#fff', stroke: '#000' })
    const calls = paint(node, 1)
    expect(calls.map((c) => c.method)).toEqual(['fillPath2D', 'strokePath2D'])
  })

  it('draws an outset shadow via shadowPath2D before the real fill', () => {
    const path = new Path2D()
    const node = new Path2DNode({
      path,
      fill: '#fff',
      shadow: { color: 'rgba(0,0,0,0.5)', offsetX: 2, offsetY: 4 },
    })
    const calls = paint(node, 1)
    expect(calls.map((c) => c.method)).toEqual(['shadowPath2D', 'fillPath2D'])
    expect(calls[0].args[0]).toBe(path)
    const style = calls[0].args[1] as GfxShadowStyle
    expect(style.color).toBe('rgba(0,0,0,0.5)')
    expect(style.offsetX).toBe(2)
    expect(style.offsetY).toBe(4)
    expect(calls[1].args).toEqual([path, '#fff'])
  })

  it('scales the shadow offset/blur/spread by strokeSpaceScale, like lineWidth', () => {
    const path = new Path2D()
    const node = new Path2DNode({
      path,
      shadow: { color: '#000', offsetX: 10, offsetY: 0, blur: 8, spread: 4 },
    })
    const calls = paint(node, 0.5) // strokeSpaceScale() = 1/2
    const style = calls[0].args[1] as GfxShadowStyle
    expect(style.offsetX).toBeCloseTo(5)
    expect(style.blur).toBeCloseTo(4)
    expect(style.spread).toBeCloseTo(2)
  })

  it('draws an inset shadow via shadowPath2D after the real fill', () => {
    const path = new Path2D()
    const node = new Path2DNode({
      path,
      fill: '#fff',
      shadow: { color: '#000', inset: true },
    })
    const calls = paint(node, 1)
    expect(calls.map((c) => c.method)).toEqual(['fillPath2D', 'shadowPath2D'])
    const style = calls[1].args[1] as GfxShadowStyle
    expect(style.inset).toBe(true)
  })

  it('draws outset shadows before the fill and inset shadows after it, in one call each', () => {
    const path = new Path2D()
    const node = new Path2DNode({
      path,
      fill: '#fff',
      shadow: [
        { color: '#111', offsetY: 2 },
        { color: '#222', inset: true },
      ],
    })
    const calls = paint(node, 1)
    expect(calls.map((c) => c.method)).toEqual([
      'shadowPath2D',
      'fillPath2D',
      'shadowPath2D',
    ])
  })

  it('passes lineAlign/lineJoin/lineCap/miterLimit/exactJoins through to strokePath2D', () => {
    const path = new Path2D()
    const node = new Path2DNode({
      path,
      stroke: '#000',
      lineWidth: 2,
      lineAlign: 'inside',
      lineJoin: 'bevel',
      lineCap: 'square',
      miterLimit: 2,
      exactJoins: true,
    })
    const calls = paint(node, 1)
    const style = calls[0].args[1] as GfxStrokeStyle
    expect(style.align).toBe('inside')
    expect(style.join).toBe('bevel')
    expect(style.cap).toBe('square')
    expect(style.miterLimit).toBe(2)
    expect(style.exactJoins).toBe(true)
  })

  it('accepts a gradient fill and stroke without narrowing them to strings', () => {
    const gradient: GfxFill = {
      kind: 'linear',
      x0: 0,
      y0: 0,
      x1: 0,
      y1: 10,
      stops: [
        { offset: 0, color: '#000' },
        { offset: 1, color: '#fff' },
      ],
    }
    const path = new Path2D()
    const node = new Path2DNode({ path, fill: gradient, stroke: gradient })
    const calls = paint(node, 1)
    expect(calls[0].args[1]).toEqual(gradient)
    const style = calls[1].args[1] as GfxStrokeStyle
    expect(style.color).toEqual(gradient)
  })

  describe('culling box', () => {
    const LOCAL = { x: 0, y: 0, width: 10, height: 10 }
    const box = (node: Path2DNode): Rect => {
      paint(node)
      return node.bounds!
    }

    it('is the bounds option with no shadow and a center-aligned border', () => {
      const node = new Path2DNode({
        path: new Path2D(),
        stroke: '#000',
        lineWidth: 4,
        bounds: LOCAL,
      })
      expect(box(node)).toEqual(LOCAL)
    })

    it('grows by the outside-aligned border width', () => {
      const node = new Path2DNode({
        path: new Path2D(),
        stroke: '#000',
        lineWidth: 4,
        lineAlign: 'outside',
        bounds: LOCAL,
      })
      expect(box(node)).toEqual({ x: -4, y: -4, width: 18, height: 18 })
    })

    it('grows by an outset shadow offset, ignoring inset ones', () => {
      const node = new Path2DNode({
        path: new Path2D(),
        shadow: [
          { color: '#000', offsetX: 3, offsetY: 4 }, // hypot = 5
          { color: '#000', offsetX: 1000, inset: true },
        ],
        bounds: LOCAL,
      })
      expect(box(node).x).toBeCloseTo(-5)
    })

    it('grows by an outset shadow blur (3 sigma) and positive spread', () => {
      const node = new Path2DNode({
        path: new Path2D(),
        shadow: { color: '#000', blur: 20, spread: 6 }, // 3 * (20/2) + 6 = 36
        bounds: LOCAL,
      })
      expect(box(node).x).toBeCloseTo(-36)
    })

    it('clamps a negative spread to not reduce the box', () => {
      const node = new Path2DNode({
        path: new Path2D(),
        shadow: { color: '#000', offsetX: 5, spread: -1000 },
        bounds: LOCAL,
      })
      expect(box(node).x).toBeCloseTo(-5)
    })

    it('is unbounded without the bounds option, so the node is never culled', () => {
      const node = new Path2DNode({ path: new Path2D(), fill: '#fff' })
      paint(node)
      expect(node.bounds).toBeNull()
    })
  })

  it('keeps a screen-space border as a width resolved at replay', () => {
    const node = new Path2DNode({
      path: new Path2D(),
      stroke: '#000',
      lineWidth: 3,
    })
    const calls = paint(node, 0.25)
    expect((calls[0].args[1] as { width: unknown }).width).toEqual({
      screen: 3,
    })
  })
})
