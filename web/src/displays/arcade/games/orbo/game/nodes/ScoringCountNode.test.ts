import { describe, it, expect } from 'vitest'
import type { Gfx2D, GfxTextStyle } from '@src/stargazer'
import { ScoringCountNode } from './ScoringCountNode'

/**
 * Minimal `Gfx2D` stub recording each `fillText` call. `ScoringCountNode.draw`
 * only ever calls this one facade method, so a full backend isn't needed.
 */
function recordingGfx(): {
  gfx: Gfx2D
  calls: { text: string; align: string; baseline: string; color: string }[]
} {
  const calls: {
    text: string
    align: string
    baseline: string
    color: string
  }[] = []
  const gfx = {
    fillText(text: string, _x: number, _y: number, style: GfxTextStyle = {}) {
      calls.push({
        text,
        align: style.align ?? '',
        baseline: style.baseline ?? '',
        color: style.color ?? '',
      })
    },
  }
  return { gfx: gfx as unknown as Gfx2D, calls }
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
