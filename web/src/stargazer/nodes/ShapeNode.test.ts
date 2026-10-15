import { describe, it, expect, vi } from 'vitest'
import { ShapeNode } from './ShapeNode'
import { paintCalls, paintPicture } from '../render/picture/paintCalls'
import type { Rect } from '../math/Rect'
import type {
  GfxFill,
  GfxShadowStyle,
  GfxStrokeStyle,
} from '../render/gfx/Gfx2D'
import type { RoundRectRadii } from '../render/gfx/roundRectRadii'

interface Call {
  method: string
  args: unknown[]
}

/**
 * The drawing calls the node paints, at `screenScale` world units per CSS
 * pixel.
 */
function paint(node: ShapeNode, screenScale = 1): Call[] {
  return paintCalls(node, { screenScale }).map((c) => ({
    method: c.name,
    args: c.args,
  }))
}

describe('ShapeNode', () => {
  it('passes corner smoothing through to every round-rect call', () => {
    const shadow = { color: '#000', blur: 8 }
    const node = new ShapeNode({
      geometry: {
        kind: 'rect',
        width: 120,
        height: 120,
        radii: 27,
        smoothing: 0.6,
      },
      fill: '#fff',
      stroke: '#000',
      shadow,
    })
    const calls = paint(node, 1)
    expect(calls.map((c) => c.method)).toEqual([
      'shadowRoundRect',
      'fillAndStrokeRoundRect',
    ])
    for (const call of calls) expect(call.args[call.args.length - 1]).toBe(0.6)
  })

  it('draws circular corners when no smoothing is given', () => {
    const node = new ShapeNode({
      geometry: { kind: 'rect', width: 100, height: 60, radii: 8 },
      fill: '#fff',
    })
    const [call] = paint(node, 1)
    expect(call.args[call.args.length - 1]).toBe(0)
  })

  it('fills and strokes a round rect in one call when both are set', () => {
    const node = new ShapeNode({
      geometry: { kind: 'rect', width: 100, height: 60, radii: 8 },
      fill: '#fff',
      stroke: '#000',
      lineWidth: 2,
    })
    const calls = paint(node, 1)
    expect(calls.map((c) => c.method)).toEqual(['fillAndStrokeRoundRect'])
  })

  it('fills and strokes a circle in one call when both are set', () => {
    const node = new ShapeNode({
      geometry: { kind: 'circle', radius: 20 },
      fill: '#fff',
      stroke: '#000',
    })
    const calls = paint(node, 1)
    expect(calls.map((c) => c.method)).toEqual(['fillAndStrokeCircle'])
  })

  it('draws outset shadows, then fill+stroke, with no inset shadow', () => {
    const node = new ShapeNode({
      geometry: { kind: 'rect', width: 100, height: 60, radii: 8 },
      fill: '#fff',
      stroke: '#000',
      lineWidth: 2,
      shadow: { color: '#000', offsetY: 4, blur: 8 },
    })
    const calls = paint(node, 1)
    expect(calls.map((c) => c.method)).toEqual([
      'shadowRoundRect',
      'fillAndStrokeRoundRect',
    ])
  })

  it('splits fill and stroke around an inset shadow: fill, inset shadow, stroke', () => {
    const node = new ShapeNode({
      geometry: { kind: 'rect', width: 100, height: 60, radii: 8 },
      fill: '#fff',
      stroke: '#000',
      lineWidth: 2,
      shadow: { color: '#000', blur: 8, inset: true },
    })
    const calls = paint(node, 1)
    expect(calls.map((c) => c.method)).toEqual([
      'fillRoundRect',
      'shadowRoundRect',
      'strokeRoundRect',
    ])
  })

  it('draws outset then inset shadows around the fill, for a mixed shadow list', () => {
    const outset: GfxShadowStyle = { color: '#000', blur: 4 }
    const inset: GfxShadowStyle = { color: '#111', blur: 2, inset: true }
    const node = new ShapeNode({
      geometry: { kind: 'circle', radius: 10 },
      fill: '#fff',
      shadow: [outset, inset],
    })
    const calls = paint(node, 1)
    expect(calls.map((c) => c.method)).toEqual([
      'shadowCircle',
      'fillCircle',
      'shadowCircle',
    ])
  })

  it('scales shadow offset/blur/spread by strokeSpaceScale, like lineWidth', () => {
    const node = new ShapeNode({
      geometry: { kind: 'circle', radius: 10 },
      shadow: { color: '#000', offsetY: 4, blur: 8, spread: 1 },
    })
    const calls = paint(node, 0.5)
    const style = calls[0].args[3] as GfxShadowStyle
    expect(style.offsetY).toBeCloseTo(2)
    expect(style.blur).toBeCloseTo(4)
    expect(style.spread).toBeCloseTo(0.5)
  })

  it('does not scale shadow lengths when strokeSpace is "world"', () => {
    const node = new ShapeNode({
      geometry: { kind: 'circle', radius: 10 },
      strokeSpace: 'world',
      shadow: { color: '#000', offsetY: 4 },
    })
    const calls = paint(node, 0.5)
    const style = calls[0].args[3] as GfxShadowStyle
    expect(style.offsetY).toBe(4)
  })

  it('passes lineAlign/lineJoin/lineCap/miterLimit through to the stroke style', () => {
    const node = new ShapeNode({
      geometry: { kind: 'rect', width: 40, height: 40, radii: 4 },
      stroke: '#000',
      lineWidth: 2,
      lineAlign: 'outside',
      lineJoin: 'bevel',
      lineCap: 'square',
      miterLimit: 2,
    })
    const calls = paint(node, 1)
    expect(calls[0].method).toBe('strokeRoundRect')
    const style = calls[0].args[5] as GfxStrokeStyle
    expect(style.align).toBe('outside')
    expect(style.join).toBe('bevel')
    expect(style.cap).toBe('square')
    expect(style.miterLimit).toBe(2)
  })

  it('routes a plain rect border through strokePolyline, carrying align/exactJoins', () => {
    const node = new ShapeNode({
      geometry: { kind: 'rect', width: 40, height: 40 },
      stroke: '#000',
      lineWidth: 2,
      exactJoins: true,
    })
    const calls = paint(node, 1)
    expect(calls[0].method).toBe('strokePolyline')
    const style = calls[0].args[2] as GfxStrokeStyle
    expect(style.exactJoins).toBe(true)
    expect(style.closed).toBe(true)
  })

  it('accepts a gradient fill and a gradient stroke without narrowing them to strings', () => {
    const gradient: GfxFill = {
      kind: 'linear',
      x0: 0,
      y0: 0,
      x1: 0,
      y1: 40,
      stops: [
        { offset: 0, color: '#000' },
        { offset: 1, color: '#fff' },
      ],
    }
    const node = new ShapeNode({
      geometry: { kind: 'rect', width: 40, height: 40, radii: 4 },
      fill: gradient,
      stroke: gradient,
    })
    const calls = paint(node, 1)
    expect(calls[0].method).toBe('fillAndStrokeRoundRect')
    expect(calls[0].args[5]).toEqual(gradient)
    const style = calls[0].args[6] as GfxStrokeStyle
    expect(style.color).toEqual(gradient)
  })

  describe('painted bounds', () => {
    const bounds = (node: ShapeNode): Rect => paintPicture(node).bounds!

    it('are the geometry for a fill with a center-aligned border', () => {
      const node = new ShapeNode({
        geometry: { kind: 'rect', width: 10, height: 10 },
        fill: '#fff',
      })
      expect(bounds(node)).toMatchObject({
        x: -5,
        y: -5,
        width: 10,
        height: 10,
      })
    })

    it('reach past the geometry for an outset shadow and not for an inset one', () => {
      const node = new ShapeNode({
        geometry: { kind: 'circle', radius: 10 },
        fill: '#fff',
        shadow: [
          { color: '#000', offsetY: 10, blur: 20, spread: 2 },
          { color: '#000', offsetY: 1000, inset: true },
        ],
      })
      const b = bounds(node)
      // 10 offset + 1.5 * 20 blur + 2 spread past the circle's edge.
      expect(b.y + b.height).toBeGreaterThanOrEqual(10 + 42)
      expect(b.y + b.height).toBeLessThan(10 + 100)
    })
  })

  describe('paint properties', () => {
    it('repaint when a field is written a new value, and not an equal one', () => {
      const node = new ShapeNode({
        geometry: { kind: 'circle', radius: 10 },
        fill: '#fff',
      })
      const dirty = vi.spyOn(node, 'markNeedsPaint')
      node.fill = '#fff'
      expect(dirty).not.toHaveBeenCalled()
      node.fill = '#f00'
      expect(dirty).toHaveBeenCalledTimes(1)
    })
  })

  describe('hit testing', () => {
    it('tests the geometry rect before the node has been painted', () => {
      const node = new ShapeNode({
        geometry: { kind: 'rect', width: 20, height: 10 },
      })
      expect(node.hitTest(9, 4, 0)).toBe(true)
      expect(node.hitTest(11, 0, 0)).toBe(false)
    })
  })

  it('resolves radii through fillAndStrokeRoundRect using the CSS border-radius shorthand', () => {
    const node = new ShapeNode({
      geometry: { kind: 'rect', width: 40, height: 40, radii: [0, 16, 0, 0] },
      fill: '#fff',
      stroke: '#000',
    })
    const calls = paint(node, 1)
    const radii = calls[0].args[4] as RoundRectRadii
    expect(radii).toEqual([0, 16, 0, 0])
  })
})

describe('ShapeNode ellipse', () => {
  const ellipse = () =>
    new ShapeNode({
      geometry: { kind: 'ellipse', radiusX: 40, radiusY: 20 },
      fill: '#fff',
      stroke: '#000',
    })

  it('fills and strokes in one call', () => {
    const calls = paint(ellipse(), 1)
    expect(calls.map((c) => c.method)).toEqual(['fillAndStrokeEllipse'])
    expect(calls[0].args.slice(0, 4)).toEqual([0, 0, 40, 20])
  })

  it('is as big as its radii, centered on its origin', () => {
    expect(ellipse().localBounds).toEqual({
      x: -40,
      y: -20,
      width: 80,
      height: 40,
    })
  })

  it('hits inside the outline and misses past it, not just outside its box', () => {
    const node = ellipse()
    expect(node.hitTest(30, 10, 0)).toBe(true)
    // Inside the bounding box, outside the ellipse.
    expect(node.hitTest(38, 18, 0)).toBe(false)
    expect(node.hitTest(41, 0, 2)).toBe(true)
  })
})
