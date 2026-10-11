import { describe, it, expect } from 'vitest'
import { ShapeNode } from './ShapeNode'
import { Camera } from '../camera/Camera'
import type { Gfx2D, GfxFill, GfxShadowStyle, GfxStrokeStyle } from '../render/gfx/Gfx2D'
import type { RoundRectRadii } from '../render/gfx/roundRectRadii'

interface Call {
  method: string
  args: unknown[]
}

function recordingGfx(): { gfx: Gfx2D; calls: Call[] } {
  const calls: Call[] = []
  const record =
    (method: string) =>
    (...args: unknown[]) => {
      calls.push({ method, args })
    }
  const gfx = {
    fillRect: record('fillRect'),
    fillRoundRect: record('fillRoundRect'),
    fillAndStrokeRoundRect: record('fillAndStrokeRoundRect'),
    fillCircle: record('fillCircle'),
    fillAndStrokeCircle: record('fillAndStrokeCircle'),
    strokeRoundRect: record('strokeRoundRect'),
    strokeCircle: record('strokeCircle'),
    strokePolyline: record('strokePolyline'),
    shadowRoundRect: record('shadowRoundRect'),
    shadowCircle: record('shadowCircle'),
  }
  return { gfx: gfx as unknown as Gfx2D, calls }
}

function cameraWithScale(scale: number): Camera {
  const cam = new Camera({ x: 0, y: 0, width: 100 / scale, height: 100 / scale })
  cam.setPixelSize(100, 100)
  return cam
}

describe('ShapeNode', () => {
  it('fills and strokes a round rect in one call when both are set', () => {
    const { gfx, calls } = recordingGfx()
    const node = new ShapeNode({
      geometry: { kind: 'rect', width: 100, height: 60, radii: 8 },
      fill: '#fff',
      stroke: '#000',
      lineWidth: 2,
    })
    node.draw(gfx, cameraWithScale(1), 0)
    expect(calls.map((c) => c.method)).toEqual(['fillAndStrokeRoundRect'])
  })

  it('fills and strokes a circle in one call when both are set', () => {
    const { gfx, calls } = recordingGfx()
    const node = new ShapeNode({
      geometry: { kind: 'circle', radius: 20 },
      fill: '#fff',
      stroke: '#000',
    })
    node.draw(gfx, cameraWithScale(1), 0)
    expect(calls.map((c) => c.method)).toEqual(['fillAndStrokeCircle'])
  })

  it('draws outset shadows, then fill+stroke, with no inset shadow', () => {
    const { gfx, calls } = recordingGfx()
    const node = new ShapeNode({
      geometry: { kind: 'rect', width: 100, height: 60, radii: 8 },
      fill: '#fff',
      stroke: '#000',
      lineWidth: 2,
      shadow: { color: '#000', offsetY: 4, blur: 8 },
    })
    node.draw(gfx, cameraWithScale(1), 0)
    expect(calls.map((c) => c.method)).toEqual([
      'shadowRoundRect',
      'fillAndStrokeRoundRect',
    ])
  })

  it('splits fill and stroke around an inset shadow: fill, inset shadow, stroke', () => {
    const { gfx, calls } = recordingGfx()
    const node = new ShapeNode({
      geometry: { kind: 'rect', width: 100, height: 60, radii: 8 },
      fill: '#fff',
      stroke: '#000',
      lineWidth: 2,
      shadow: { color: '#000', blur: 8, inset: true },
    })
    node.draw(gfx, cameraWithScale(1), 0)
    expect(calls.map((c) => c.method)).toEqual([
      'fillRoundRect',
      'shadowRoundRect',
      'strokeRoundRect',
    ])
  })

  it('draws outset then inset shadows around the fill, for a mixed shadow list', () => {
    const { gfx, calls } = recordingGfx()
    const outset: GfxShadowStyle = { color: '#000', blur: 4 }
    const inset: GfxShadowStyle = { color: '#111', blur: 2, inset: true }
    const node = new ShapeNode({
      geometry: { kind: 'circle', radius: 10 },
      fill: '#fff',
      shadow: [outset, inset],
    })
    node.draw(gfx, cameraWithScale(1), 0)
    expect(calls.map((c) => c.method)).toEqual([
      'shadowCircle',
      'fillCircle',
      'shadowCircle',
    ])
  })

  it('scales shadow offset/blur/spread by strokeSpaceScale, like lineWidth', () => {
    const { gfx, calls } = recordingGfx()
    const node = new ShapeNode({
      geometry: { kind: 'circle', radius: 10 },
      shadow: { color: '#000', offsetY: 4, blur: 8, spread: 1 },
    })
    node.draw(gfx, cameraWithScale(2), 0) // strokeSpaceScale() = 1/2
    const style = calls[0].args[3] as GfxShadowStyle
    expect(style.offsetY).toBeCloseTo(2)
    expect(style.blur).toBeCloseTo(4)
    expect(style.spread).toBeCloseTo(0.5)
  })

  it('does not scale shadow lengths when strokeSpace is "world"', () => {
    const { gfx, calls } = recordingGfx()
    const node = new ShapeNode({
      geometry: { kind: 'circle', radius: 10 },
      strokeSpace: 'world',
      shadow: { color: '#000', offsetY: 4 },
    })
    node.draw(gfx, cameraWithScale(2), 0)
    const style = calls[0].args[3] as GfxShadowStyle
    expect(style.offsetY).toBe(4)
  })

  it('passes lineAlign/lineJoin/lineCap/miterLimit through to the stroke style', () => {
    const { gfx, calls } = recordingGfx()
    const node = new ShapeNode({
      geometry: { kind: 'rect', width: 40, height: 40, radii: 4 },
      stroke: '#000',
      lineWidth: 2,
      lineAlign: 'outside',
      lineJoin: 'bevel',
      lineCap: 'square',
      miterLimit: 2,
    })
    node.draw(gfx, cameraWithScale(1), 0)
    expect(calls[0].method).toBe('strokeRoundRect')
    const style = calls[0].args[5] as GfxStrokeStyle
    expect(style.align).toBe('outside')
    expect(style.join).toBe('bevel')
    expect(style.cap).toBe('square')
    expect(style.miterLimit).toBe(2)
  })

  it('routes a plain rect border through strokePolyline, carrying align/exactJoins', () => {
    const { gfx, calls } = recordingGfx()
    const node = new ShapeNode({
      geometry: { kind: 'rect', width: 40, height: 40 },
      stroke: '#000',
      lineWidth: 2,
      exactJoins: true,
    })
    node.draw(gfx, cameraWithScale(1), 0)
    expect(calls[0].method).toBe('strokePolyline')
    const style = calls[0].args[2] as GfxStrokeStyle
    expect(style.exactJoins).toBe(true)
    expect(style.closed).toBe(true)
  })

  it('accepts a gradient fill and a gradient stroke without narrowing them to strings', () => {
    const { gfx, calls } = recordingGfx()
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
    node.draw(gfx, cameraWithScale(1), 0)
    expect(calls[0].method).toBe('fillAndStrokeRoundRect')
    expect(calls[0].args[5]).toBe(gradient)
    const style = calls[0].args[6] as GfxStrokeStyle
    expect(style.color).toBe(gradient)
  })

  describe('cullMargin', () => {
    it('is 0 with no shadow and a center-aligned border', () => {
      const node = new ShapeNode({
        geometry: { kind: 'rect', width: 10, height: 10 },
        stroke: '#000',
        lineWidth: 4,
      })
      expect(node.cullMargin).toBe(0)
    })

    it('includes the full lineWidth for an outside-aligned border', () => {
      const node = new ShapeNode({
        geometry: { kind: 'rect', width: 10, height: 10 },
        stroke: '#000',
        lineWidth: 4,
        lineAlign: 'outside',
      })
      expect(node.cullMargin).toBe(4)
    })

    it('includes offset + 3*sigma + spread for an outset shadow, ignores inset ones', () => {
      const node = new ShapeNode({
        geometry: { kind: 'circle', radius: 10 },
        shadow: [
          { color: '#000', offsetY: 10, blur: 20, spread: 2 }, // 10 + 30 + 2 = 42
          { color: '#000', offsetY: 1000, inset: true }, // ignored
        ],
      })
      expect(node.cullMargin).toBeCloseTo(42)
    })
  })

  it('resolves radii through fillAndStrokeRoundRect using the CSS border-radius shorthand', () => {
    const { gfx, calls } = recordingGfx()
    const node = new ShapeNode({
      geometry: { kind: 'rect', width: 40, height: 40, radii: [0, 16, 0, 0] },
      fill: '#fff',
      stroke: '#000',
    })
    node.draw(gfx, cameraWithScale(1), 0)
    const radii = calls[0].args[4] as RoundRectRadii
    expect(radii).toEqual([0, 16, 0, 0])
  })
})
