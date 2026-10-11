import { describe, it, expect } from 'vitest'
import { Path2DNode } from './Path2DNode'
import { Camera } from '../camera/Camera'
import type { Gfx2D, GfxFill, GfxStrokeStyle } from '../render/gfx/Gfx2D'

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
    save: record('save'),
    restore: record('restore'),
    translate: record('translate'),
    fillPath2D: record('fillPath2D'),
    strokePath2D: record('strokePath2D'),
  }
  return { gfx: gfx as unknown as Gfx2D, calls }
}

function cameraWithScale(scale: number): Camera {
  const cam = new Camera({ x: 0, y: 0, width: 100 / scale, height: 100 / scale })
  cam.setPixelSize(100, 100)
  return cam
}

describe('Path2DNode', () => {
  it('fills then strokes, with no shadow', () => {
    const { gfx, calls } = recordingGfx()
    const path = new Path2D()
    const node = new Path2DNode({ path, fill: '#fff', stroke: '#000' })
    node.draw(gfx, cameraWithScale(1), 0)
    expect(calls.map((c) => c.method)).toEqual(['fillPath2D', 'strokePath2D'])
  })

  it('draws an outset hard shadow as a translated fillPath2D before the real fill', () => {
    const { gfx, calls } = recordingGfx()
    const path = new Path2D()
    const node = new Path2DNode({
      path,
      fill: '#fff',
      shadow: { color: 'rgba(0,0,0,0.5)', offsetX: 2, offsetY: 4 },
    })
    node.draw(gfx, cameraWithScale(1), 0)
    expect(calls.map((c) => c.method)).toEqual([
      'save',
      'translate',
      'fillPath2D',
      'restore',
      'fillPath2D',
    ])
    expect(calls[1].args).toEqual([2, 4])
    expect(calls[2].args).toEqual([path, 'rgba(0,0,0,0.5)'])
    expect(calls[4].args).toEqual([path, '#fff'])
  })

  it('scales the shadow offset by strokeSpaceScale, like lineWidth', () => {
    const { gfx, calls } = recordingGfx()
    const path = new Path2D()
    const node = new Path2DNode({
      path,
      shadow: { color: '#000', offsetX: 10, offsetY: 0 },
    })
    node.draw(gfx, cameraWithScale(2), 0) // strokeSpaceScale() = 1/2
    const translateCall = calls.find((c) => c.method === 'translate')!
    expect(translateCall.args[0]).toBeCloseTo(5)
  })

  it('skips an inset shadow (not yet implemented for an arbitrary path)', () => {
    const { gfx, calls } = recordingGfx()
    const path = new Path2D()
    const node = new Path2DNode({
      path,
      fill: '#fff',
      shadow: { color: '#000', inset: true },
    })
    node.draw(gfx, cameraWithScale(1), 0)
    expect(calls.map((c) => c.method)).toEqual(['fillPath2D'])
  })

  it('passes lineAlign/lineJoin/lineCap/miterLimit/exactJoins through to strokePath2D', () => {
    const { gfx, calls } = recordingGfx()
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
    node.draw(gfx, cameraWithScale(1), 0)
    const style = calls[0].args[1] as GfxStrokeStyle
    expect(style.align).toBe('inside')
    expect(style.join).toBe('bevel')
    expect(style.cap).toBe('square')
    expect(style.miterLimit).toBe(2)
    expect(style.exactJoins).toBe(true)
  })

  it('accepts a gradient fill and stroke without narrowing them to strings', () => {
    const { gfx, calls } = recordingGfx()
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
    node.draw(gfx, cameraWithScale(1), 0)
    expect(calls[0].args[1]).toBe(gradient)
    const style = calls[1].args[1] as GfxStrokeStyle
    expect(style.color).toBe(gradient)
  })

  describe('cullMargin', () => {
    it('is 0 with no shadow and a center-aligned border', () => {
      const node = new Path2DNode({ path: new Path2D(), stroke: '#000', lineWidth: 4 })
      expect(node.cullMargin).toBe(0)
    })

    it('includes the outside-aligned border width', () => {
      const node = new Path2DNode({
        path: new Path2D(),
        stroke: '#000',
        lineWidth: 4,
        lineAlign: 'outside',
      })
      expect(node.cullMargin).toBe(4)
    })

    it('includes an outset shadow offset magnitude, ignoring inset ones', () => {
      const node = new Path2DNode({
        path: new Path2D(),
        shadow: [
          { color: '#000', offsetX: 3, offsetY: 4 }, // hypot = 5
          { color: '#000', offsetX: 1000, inset: true },
        ],
      })
      expect(node.cullMargin).toBeCloseTo(5)
    })
  })
})
