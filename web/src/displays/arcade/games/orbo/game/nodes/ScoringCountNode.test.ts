import { describe, it, expect } from 'vitest'
import { Canvas2DGfx } from '@src/stargazer'
import { ScoringCountNode } from './ScoringCountNode'

/** Canvas2D facade over a stub that records fillText calls + the active style. */
function recordingGfx(): {
  gfx: Canvas2DGfx
  calls: { text: string; align: string; baseline: string; color: string }[]
} {
  const s = { align: '', baseline: '', color: '' }
  const calls: {
    text: string
    align: string
    baseline: string
    color: string
  }[] = []
  const ctx = {
    font: '',
    get textAlign() {
      return s.align
    },
    set textAlign(v: string) {
      s.align = v
    },
    get textBaseline() {
      return s.baseline
    },
    set textBaseline(v: string) {
      s.baseline = v
    },
    get fillStyle() {
      return s.color
    },
    set fillStyle(v: string) {
      s.color = v
    },
    fillText(text: string) {
      calls.push({ text, align: s.align, baseline: s.baseline, color: s.color })
    },
  } as unknown as CanvasRenderingContext2D
  return { gfx: new Canvas2DGfx(ctx), calls }
}

describe('ScoringCountNode', () => {
  it('draws the current count centered, in the given color', () => {
    const { gfx, calls } = recordingGfx()
    const node = new ScoringCountNode(() => 3, 100, 200, '#E24A4A')
    node.draw(gfx)
    expect(calls).toHaveLength(1)
    expect(calls[0].text).toBe('3')
    expect(calls[0].align).toBe('center')
    expect(calls[0].baseline).toBe('middle')
    expect(calls[0].color).toBe('#E24A4A')
  })

  it('re-evaluates the count each draw (live)', () => {
    const { gfx, calls } = recordingGfx()
    let n = 0
    const node = new ScoringCountNode(() => n, 0, 0, '#000')
    node.draw(gfx)
    n = 5
    node.draw(gfx)
    expect(calls.map((c) => c.text)).toEqual(['0', '5'])
  })

  it('positions itself at the given anchor', () => {
    const node = new ScoringCountNode(() => 1, 100, 250, '#000')
    expect(node.transform.x).toBe(100)
    expect(node.transform.y).toBe(250)
  })
})
