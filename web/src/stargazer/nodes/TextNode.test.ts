import { describe, it, expect } from 'vitest'
import { TextNode } from './TextNode'
import { Camera } from '../camera/Camera'
import { Canvas2DGfx } from '../render/gfx/Canvas2DGfx'

/**
 * Canvas2D facade over a recording stub that captures each `fillText` call and
 * the `font`/`align`/`color` active at the time (Canvas2DGfx sets those before
 * calling `fillText`). Mirrors the ctx-stub pattern used elsewhere.
 */
function recordingGfx(): {
  gfx: Canvas2DGfx
  calls: { text: string; font: string; align: string; color: string }[]
} {
  const state = { font: '', align: '', color: '' }
  const calls: { text: string; font: string; align: string; color: string }[] =
    []
  const ctx = {
    get font() {
      return state.font
    },
    set font(v: string) {
      state.font = v
    },
    get textAlign() {
      return state.align
    },
    set textAlign(v: string) {
      state.align = v
    },
    textBaseline: '',
    get fillStyle() {
      return state.color
    },
    set fillStyle(v: string) {
      state.color = v
    },
    fillText(text: string) {
      calls.push({
        text,
        font: state.font,
        align: state.align,
        color: state.color,
      })
    },
  } as unknown as CanvasRenderingContext2D
  return { gfx: new Canvas2DGfx(ctx), calls }
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
})
