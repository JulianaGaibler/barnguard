import { describe, it, expect, vi } from 'vitest'
import { TextNode } from './TextNode'
import { Camera } from '../camera/Camera'
import { BoxConstraints } from '../layout/constraints'
import type { Gfx2D, GfxTextStyle } from '../render/gfx/Gfx2D'

// `measureText` depends on a real Canvas2D text engine, unavailable under
// happy-dom. Stub it with a deterministic width (10px/char) so `measure()`
// tests can assert on layout math rather than font shaping.
vi.mock('../render/gfx/rasterizeLabel', () => ({
  measureText: (text: string) => ({
    localW: text.length * 10,
    localH: 0,
    anchorOffsetX: 0,
    anchorOffsetY: 0,
  }),
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

/**
 * Minimal `Gfx2D` stub recording each `fillText` call. `TextNode.draw` only
 * ever calls this one facade method, so a full backend isn't needed.
 */
function recordingGfx(): {
  gfx: Gfx2D
  calls: FillTextCall[]
} {
  const calls: FillTextCall[] = []
  const gfx = {
    fillText(text: string, x: number, y: number, style: GfxTextStyle = {}) {
      calls.push({
        text,
        x,
        y,
        font: style.font ?? '',
        align: style.align ?? '',
        baseline: style.baseline ?? '',
        color: style.color ?? '',
      })
    },
  }
  return { gfx: gfx as unknown as Gfx2D, calls }
}

/**
 * Camera whose world→screen scale is `scale` (so `strokeSpaceScale()` is
 * 1/scale).
 */
function cameraWithScale(scale: number): Camera {
  const cam = new Camera({
    x: 0,
    y: 0,
    width: 100 / scale,
    height: 100 / scale,
  })
  cam.setPixelSize(100, 100)
  return cam
}

describe('TextNode', () => {
  it('draws the text with the composed font string', () => {
    const { gfx, calls } = recordingGfx()
    const node = new TextNode({
      text: 'hello',
      fontFamily: 'sans-serif',
      fontWeight: 700,
      fontSize: 16,
      color: '#123',
    })
    node.draw(gfx, cameraWithScale(1), 0)
    expect(calls).toHaveLength(1)
    expect(calls[0].text).toBe('hello')
    expect(calls[0].font).toBe('700 16px sans-serif')
    expect(calls[0].color).toBe('#123')
  })

  it('scales screen-space font size by 1/camera-scale (constant on-screen size)', () => {
    const { gfx, calls } = recordingGfx()
    const node = new TextNode({ text: 'hi', fontSize: 20, sizeSpace: 'screen' })
    node.draw(gfx, cameraWithScale(2), 0) // strokeSpaceScale() = 0.5
    expect(calls[0].font).toBe('normal 10px sans-serif')
  })

  it('leaves world-space font size unscaled', () => {
    const { gfx, calls } = recordingGfx()
    const node = new TextNode({ text: 'hi', fontSize: 20, sizeSpace: 'world' })
    node.draw(gfx, cameraWithScale(2), 0)
    expect(calls[0].font).toBe('normal 20px sans-serif')
  })

  it('does not draw an empty string', () => {
    const { gfx, calls } = recordingGfx()
    const node = new TextNode({ text: '' })
    node.draw(gfx, cameraWithScale(1), 0)
    expect(calls).toHaveLength(0)
  })

  describe('multi-line', () => {
    it('draws one fillText call per line, each with baseline "top"', () => {
      const { gfx, calls } = recordingGfx()
      const node = new TextNode({
        text: 'one\ntwo\nthree',
        fontSize: 10,
        baseline: 'top',
      })
      node.draw(gfx, cameraWithScale(1), 0)
      expect(calls.map((c) => c.text)).toEqual(['one', 'two', 'three'])
      expect(calls.every((c) => c.baseline === 'top')).toBe(true)
    })

    it('spaces lines by fontSize * lineHeight, default 1.2', () => {
      const { gfx, calls } = recordingGfx()
      const node = new TextNode({
        text: 'a\nb',
        fontSize: 10,
        baseline: 'top',
        y: 0,
      })
      node.draw(gfx, cameraWithScale(1), 0)
      expect(calls[0].y).toBe(0)
      expect(calls[1].y).toBeCloseTo(12) // 10 * 1.2
    })

    it('honors a custom lineHeight', () => {
      const { gfx, calls } = recordingGfx()
      const node = new TextNode({
        text: 'a\nb',
        fontSize: 10,
        baseline: 'top',
        lineHeight: 2,
        y: 0,
      })
      node.draw(gfx, cameraWithScale(1), 0)
      expect(calls[1].y).toBeCloseTo(20) // 10 * 2
    })

    it('anchors the whole block on y for baseline "middle"', () => {
      const { gfx, calls } = recordingGfx()
      const node = new TextNode({
        text: 'a\nb',
        fontSize: 10,
        baseline: 'middle',
        y: 100,
      })
      node.draw(gfx, cameraWithScale(1), 0)
      // total block height = 24 (2 lines * 12); top = 100 - 12
      expect(calls[0].y).toBeCloseTo(88)
      expect(calls[1].y).toBeCloseTo(100)
    })

    it('anchors the whole block above y for baseline "bottom"', () => {
      const { gfx, calls } = recordingGfx()
      const node = new TextNode({
        text: 'a\nb',
        fontSize: 10,
        baseline: 'bottom',
        y: 100,
      })
      node.draw(gfx, cameraWithScale(1), 0)
      // total block height = 24; top = 100 - 24
      expect(calls[0].y).toBeCloseTo(76)
      expect(calls[1].y).toBeCloseTo(88)
    })
  })

  describe('measure', () => {
    it('measures single-line text width and fontSize*lineHeight height', () => {
      const node = new TextNode({ text: 'hi', fontSize: 10 })
      const size = node.measure(BoxConstraints.loose(Infinity, Infinity))
      expect(size.h).toBeCloseTo(12) // 10 * 1.2
      expect(size.w).toBe(20) // stubbed measureText: 2 chars * 10
    })

    it('measures multi-line width as the widest line, height as fontSize*lineHeight*lineCount', () => {
      const node = new TextNode({ text: 'one\ntwo\nthree', fontSize: 10 })
      const size = node.measure(BoxConstraints.loose(Infinity, Infinity))
      expect(size.h).toBeCloseTo(36) // 10 * 1.2 * 3
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

    it('writes debugBounds for culling/hit-testing', () => {
      const node = new TextNode({ text: 'hi' })
      node.arrange(10, 20, 100, 50)
      expect(node.debugBounds).toEqual({ x: 0, y: 0, width: 100, height: 50 })
    })
  })
})
