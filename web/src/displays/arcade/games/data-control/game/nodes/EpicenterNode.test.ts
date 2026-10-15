import { describe, expect, it } from 'vitest'
import { paintCalls } from '@src/stargazer'
import { EpicenterNode } from './EpicenterNode'

function build(): EpicenterNode {
  return new EpicenterNode({
    center: { x: 10, y: 20 },
    approachReference: { x: 100, y: 20 },
  })
}

describe('EpicenterNode', () => {
  it('paints only the apex disc, so the breathing and pulse repaint nothing', () => {
    const node = build()
    const before = paintCalls(node)
    node.outerAlpha = 0.5
    node.outerScale = 0.8
    node.pulseScale = 0.4
    expect(paintCalls(node)).toEqual(before)
    expect(before.map((c) => c.name)).toEqual(['fillCircle'])
  })

  it('fades and grows the pulse wedge from the apex as pulseScale rises', () => {
    const node = build()
    const [base, pulse] = node.children as unknown as [
      { visible: boolean; transform: { alpha: number; scaleX: number } },
      { visible: boolean; transform: { alpha: number; scaleX: number } },
    ]
    expect(pulse.visible).toBe(false)
    node.pulseScale = 0.25
    expect(pulse.visible).toBe(true)
    expect(pulse.transform.scaleX).toBeCloseTo(0.25)
    expect(pulse.transform.alpha).toBeCloseTo(0.75)
    node.pulseScale = 1
    expect(pulse.visible).toBe(false)
    expect(base.visible).toBe(true)
  })

  it('hides the base wedge until it has grown in', () => {
    const node = build()
    const [base] = node.children as unknown as [{ visible: boolean }]
    node.outerScale = 0
    expect(base.visible).toBe(false)
    node.outerScale = 0.7
    expect(base.visible).toBe(true)
  })
})
