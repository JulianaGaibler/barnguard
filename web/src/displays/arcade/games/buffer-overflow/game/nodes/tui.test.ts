/**
 * The kit's arithmetic and its draw shape.
 *
 * Only the parts that do not need a canvas are pinned here. Text advances come
 * from a real `measureText`, which the test environment does not have, so
 * anything positioned from an advance is checked in `?demo=bufferoverflow-tui`
 * instead, per this repo's split of arithmetic into tests and pixels into
 * demos.
 */
import { describe, expect, it } from 'vitest'
import type { Gfx2D } from '@src/stargazer'
import {
  cursorAlpha,
  drawCap,
  drawFrame,
  drawMeter,
  drawRun,
  frameBody,
  meterCells,
  runLayout,
} from './tui'
import { ANIM } from '../tuning'

interface Line {
  x0: number
  y0: number
  x1: number
  y1: number
  width: number
}
interface Quad {
  x: number
  y: number
  w: number
  h: number
  color: string
}

/** Captures the primitives a draw call emits. */
function recorder(): {
  gfx: Gfx2D
  lines: Line[]
  quads: Quad[]
  rects: Quad[]
  texts: string[]
} {
  const lines: Line[] = []
  const quads: Quad[] = []
  const rects: Quad[] = []
  const texts: string[] = []
  const noop = (): void => {}
  const gfx = {
    setAlpha: noop,
    setBlend: noop,
    save: noop,
    restore: noop,
    snapSize: (v: number) => Math.max(1, Math.round(v)),
    fillRoundRect: (
      x: number,
      y: number,
      w: number,
      h: number,
      _r: number,
      color: string,
    ) => quads.push({ x, y, w, h, color }),
    strokeRoundRect: (
      x: number,
      y: number,
      w: number,
      h: number,
      _r: number,
      s: { color: string },
    ) => rects.push({ x, y, w, h, color: s.color }),
    strokeLine: (
      x0: number,
      y0: number,
      x1: number,
      y1: number,
      s: { width: number },
    ) => lines.push({ x0, y0, x1, y1, width: s.width }),
    fillText: (t: string) => texts.push(t),
  } as unknown as Gfx2D
  return { gfx, lines, quads, rects, texts }
}

const RECT = { x: 100, y: 200, width: 400, height: 300 }

describe('meterCells', () => {
  it('lights every cell at the maximum and none at zero', () => {
    expect(meterCells(10, 10, 12)).toBe(12)
    expect(meterCells(0, 10, 12)).toBe(0)
  })

  it('lights one cell for any value too small to fill one', () => {
    // A meter reading empty while the clock is still running is worse than a
    // cell of imprecision.
    expect(meterCells(0.01, 45, 12)).toBe(1)
  })

  it('clamps outside the range instead of overrunning the run', () => {
    expect(meterCells(99, 10, 12)).toBe(12)
    expect(meterCells(-5, 10, 12)).toBe(0)
  })

  it('reads zero rather than dividing by a zero maximum', () => {
    expect(meterCells(5, 0, 12)).toBe(0)
    expect(meterCells(5, 10, 0)).toBe(0)
  })
})

describe('frameBody', () => {
  it('insets by the rule and the padding on all four sides', () => {
    expect(frameBody(RECT, 2, 8)).toEqual({
      x: 110,
      y: 210,
      width: 380,
      height: 280,
    })
  })

  it('clamps to zero rather than reporting a negative box', () => {
    const tiny = frameBody({ x: 0, y: 0, width: 4, height: 4 }, 2, 8)
    expect(tiny.width).toBe(0)
    expect(tiny.height).toBe(0)
  })
})

describe('runLayout', () => {
  it('anchors a run left, centred or right', () => {
    expect(runLayout(4, 10, 'left')).toBe(0)
    expect(runLayout(4, 10, 'center')).toBe(-20)
    expect(runLayout(4, 10, 'right')).toBe(-40)
  })

  it('defaults to left', () => {
    expect(runLayout(3, 10)).toBe(0)
  })
})

describe('cursorAlpha', () => {
  it('is on for the first half of the period and off for the second', () => {
    expect(cursorAlpha(0)).toBe(1)
    expect(cursorAlpha(ANIM.blink * 0.25)).toBe(1)
    expect(cursorAlpha(ANIM.blink * 0.75)).toBe(0)
  })

  it('repeats, so every cursor on screen agrees', () => {
    expect(cursorAlpha(ANIM.blink * 4.25)).toBe(cursorAlpha(ANIM.blink * 0.25))
  })

  it('handles a negative clock without inverting the phase', () => {
    expect(cursorAlpha(-ANIM.blink * 0.75)).toBe(1)
  })
})

describe('drawFrame', () => {
  it('draws four rules for an untitled frame', () => {
    const { gfx, lines } = recorder()
    drawFrame(gfx, RECT, { color: '#fff', width: 2 })
    expect(lines).toHaveLength(4)
  })

  it('keeps the verticals clear of the horizontals', () => {
    // Two translucent strokes crossing double-blend into a darker notch, so the
    // uprights stop one rule width short at each end.
    const { gfx, lines } = recorder()
    drawFrame(gfx, RECT, { color: '#fff', width: 2 })
    const uprights = lines.filter((l) => l.x0 === l.x1)
    expect(uprights).toHaveLength(2)
    for (const l of uprights) {
      expect(Math.min(l.y0, l.y1)).toBe(RECT.y + 2)
      expect(Math.max(l.y0, l.y1)).toBe(RECT.y + RECT.height - 2)
    }
  })

  it('paints a fill under the rule when one is given', () => {
    const { gfx, quads } = recorder()
    drawFrame(gfx, RECT, { color: '#fff', width: 2, fill: '#111' })
    expect(quads).toEqual([{ x: 100, y: 200, w: 400, h: 300, color: '#111' }])
  })

  it('breaks the top rule and sets the title in the gap', () => {
    const { gfx, lines, texts } = recorder()
    drawFrame(gfx, RECT, {
      color: '#fff',
      width: 2,
      title: { text: 'bank', font: '400 12px mono', color: '#aaa' },
    })
    expect(texts).toEqual(['bank'])
    // Advances read zero without a canvas, so the gap collapses and only its
    // presence can be checked here. Where the rule actually breaks is a demo
    // check.
    expect(lines.filter((l) => l.y0 === l.y1).length).toBeGreaterThanOrEqual(2)
  })

  it('draws nothing for an empty rect', () => {
    const { gfx, lines, quads } = recorder()
    drawFrame(
      gfx,
      { x: 0, y: 0, width: 0, height: 10 },
      {
        color: '#fff',
        width: 2,
        fill: '#111',
      },
    )
    expect(lines).toHaveLength(0)
    expect(quads).toHaveLength(0)
  })
})

describe('drawCap', () => {
  const base = { rule: '#f0f', width: 2, ink: '#eee', pressedInk: '#111' }

  it('strokes at rest and hands back the resting ink', () => {
    const { gfx, rects, quads } = recorder()
    expect(drawCap(gfx, RECT, base)).toBe('#eee')
    expect(rects).toHaveLength(1)
    expect(quads).toHaveLength(0)
  })

  it('inverts when pressed and hands back the knocked-out ink', () => {
    const { gfx, rects, quads } = recorder()
    expect(drawCap(gfx, RECT, { ...base, pressed: true })).toBe('#111')
    expect(quads).toEqual([{ x: 100, y: 200, w: 400, h: 300, color: '#f0f' }])
    expect(rects).toHaveLength(0)
  })

  it('doubles the rule for the action that commits', () => {
    const { gfx, rects } = recorder()
    drawCap(gfx, RECT, { ...base, heavy: true })
    expect(rects).toHaveLength(2)
    expect(rects[1].w).toBeLessThan(rects[0].w)
  })
})

describe('drawRun', () => {
  const opts = { x: 0, y: 0, font: '700 20px mono', color: '#fff', advance: 10 }

  it('draws one label per character, so the alphabet stays cached', () => {
    const { gfx, texts } = recorder()
    drawRun(gfx, '1240', opts)
    expect(texts).toEqual(['1', '2', '4', '0'])
  })

  it('skips spaces rather than minting a blank label', () => {
    const { gfx, texts } = recorder()
    drawRun(gfx, '12 40', opts)
    expect(texts).toEqual(['1', '2', '4', '0'])
  })
})

describe('drawMeter', () => {
  it('splits the run into cells and lights the filled ones', () => {
    const { gfx, quads } = recorder()
    drawMeter(
      gfx,
      { x: 0, y: 0, width: 100, height: 10 },
      {
        value: 5,
        max: 10,
        cells: 10,
        color: '#lit',
        trackColor: '#dim',
      },
    )
    expect(quads).toHaveLength(10)
    expect(quads.filter((q) => q.color === '#lit')).toHaveLength(5)
  })

  it('draws nothing when it has no cells to draw', () => {
    const { gfx, quads } = recorder()
    drawMeter(
      gfx,
      { x: 0, y: 0, width: 100, height: 10 },
      {
        value: 5,
        max: 10,
        cells: 0,
        color: '#lit',
        trackColor: '#dim',
      },
    )
    expect(quads).toHaveLength(0)
  })
})
