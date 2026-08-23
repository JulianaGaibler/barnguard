import { describe, expect, it } from 'vitest'
import type { Gfx2D } from '@src/stargazer'
import { FAMILIES } from '@src/core/theme'
import { counterLayout, NoticeNode } from './HudNodes'

/** Captures the text runs a node draws, with the font each asked for. */
function textRecorder(): {
  gfx: Gfx2D
  runs: { text: string; font: string }[]
} {
  const runs: { text: string; font: string }[] = []
  const noop = (): void => {}
  const gfx = {
    setAlpha: noop,
    fillRect: noop,
    fillRoundRect: noop,
    fillCircle: noop,
    fillConvexPoly: noop,
    strokeLine: noop,
    strokeQuadratic: noop,
    strokePolyline: noop,
    strokeRoundRect: noop,
    fillText: (
      text: string,
      _x: number,
      _y: number,
      style?: { font?: string },
    ) => runs.push({ text, font: style?.font ?? '' }),
  } as unknown as Gfx2D
  return { gfx, runs }
}

/**
 * The `used/max` counter is shared by the game's readout and the tutorial card
 * that is about the move limit, so its layout is pinned once here.
 *
 * Only the arithmetic is checked. The advances it works from come from a real
 * canvas, which the test environment does not have, and per this repo's
 * convention the drawn result is checked in a `?demo=` scene instead.
 */
describe('counterLayout', () => {
  const GAP = 4

  it('centres the whole group on the origin', () => {
    const g = counterLayout(30, 45, GAP)
    expect(g.left).toBeCloseTo(-g.total / 2, 9)
    expect(g.left + g.total).toBeCloseTo(g.total / 2, 9)
  })

  it('stays centred however many digits the count has', () => {
    // The bug this replaced: a fixed anchor let the group drift right as the
    // count grew, leaving it lopsided against the caption below.
    for (const usedAdvance of [12, 24, 36, 48]) {
      const g = counterLayout(usedAdvance, 45, GAP)
      const rightEdge = g.maxLeft + 45
      expect(g.left, `used ${usedAdvance}`).toBeCloseTo(-rightEdge, 9)
    }
  })

  it('puts the max run one gap after the used run', () => {
    const g = counterLayout(30, 45, GAP)
    expect(g.maxLeft - (g.left + 30)).toBeCloseTo(GAP, 9)
  })

  it('centres the used run inside its own share', () => {
    // The tick pop scales the number about this point, so it has to be the
    // middle of the number rather than either edge.
    const g = counterLayout(30, 45, GAP)
    expect(g.usedCenter - g.left).toBeCloseTo(15, 9)
  })

  it('accounts for every part in the total', () => {
    expect(counterLayout(30, 45, GAP).total).toBeCloseTo(30 + GAP + 45, 9)
  })

  it('degrades to a centred gap when nothing can be measured', () => {
    // A canvas that reports no advances must still produce a symmetric layout
    // rather than pushing the runs off to one side.
    const g = counterLayout(0, 0, GAP)
    expect(g.left).toBeCloseTo(-GAP / 2, 9)
    expect(g.maxLeft).toBeCloseTo(GAP / 2, 9)
  })
})

describe('NoticeNode', () => {
  /** A notice already faded in, so it draws at full strength. */
  function shown(text: string): NoticeNode {
    const node = new NoticeNode()
    node.setSize(60)
    node.show(text)
    node.onUpdate(1)
    return node
  }

  it('draws its status line in the body face, not the display one', () => {
    // A heading face set at this size shouts, and this is a status line.
    const node = shown('Waiting for the other player')
    const rec = textRecorder()
    node.draw(rec.gfx)
    expect(rec.runs).toHaveLength(1)
    expect(rec.runs[0]!.font).toContain('Mozilla Text')
    expect(rec.runs[0]!.font).not.toContain('Sniglet')
  })

  it('sits the text on a baseline rather than the em box', () => {
    const node = shown('Waiting')
    const calls: unknown[][] = []
    const gfx = new Proxy(
      {},
      {
        get:
          () =>
          (...args: unknown[]) =>
            calls.push(args),
      },
    ) as unknown as Gfx2D
    node.draw(gfx)
    const text = calls.find((a) => typeof a[0] === 'string' && a.length === 4)
    expect((text?.[3] as { baseline?: string })?.baseline).toBe('alphabetic')
  })

  it('draws nothing once hidden', () => {
    const node = shown('Waiting')
    node.hide()
    expect(node.visible).toBe(false)
  })

  it('names a real family, so nothing falls back silently', () => {
    const node = shown('Waiting')
    const rec = textRecorder()
    node.draw(rec.gfx)
    expect(rec.runs[0]!.font).toContain(
      FAMILIES.mozillaText.split(',')[0]!.trim(),
    )
  })
})
