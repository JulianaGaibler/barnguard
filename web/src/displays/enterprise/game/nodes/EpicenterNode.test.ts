import { describe, expect, it } from 'vitest'
import { paintCalls, type Node2D } from 'stargazer'
import { EpicenterNode } from './EpicenterNode'

function build(): { node: EpicenterNode; dots: Node2D } {
  const node = new EpicenterNode({
    center: { x: 0, y: 0 },
    approachReference: { x: 100, y: 0 },
  })
  return { node, dots: node.children[0] as Node2D }
}

describe('EpicenterNode', () => {
  it('fades the dots through the transform only', () => {
    const { node, dots } = build()
    dots._paintDirty = false
    node.outerAlpha = 0.6
    expect(dots._paintDirty).toBe(false)
    expect(dots.transform.alpha).toBeCloseTo(0.6, 6)
  })

  it('repaints the dots while the wave or the grow-in moves', () => {
    const { node, dots } = build()
    dots._paintDirty = false
    node.wavePhase = 0.25
    expect(dots._paintDirty).toBe(true)
    dots._paintDirty = false
    node.outerScale = 0.7
    expect(dots._paintDirty).toBe(true)
  })

  it('wraps the wave phase into [0, 1)', () => {
    const { node } = build()
    node.wavePhase = 2.25
    expect(node.wavePhase).toBeCloseTo(0.25, 6)
  })

  it('draws the cone as one shader quad over its bounding square', () => {
    const { node, dots } = build()
    const calls = paintCalls(dots, { screenScale: 1 })
    const quads = calls.filter((c) => c.name === 'drawShaderQuad')
    expect(quads).toHaveLength(1)
    const r = node.coneRadius
    expect(quads[0].args.slice(1)).toEqual([-r, -r, r * 2, r * 2])
  })

  it('keeps the edge lines a fixed CSS width at any zoom', () => {
    const { dots } = build()
    const quad = paintCalls(dots, { screenScale: 2 }).find(
      (c) => c.name === 'drawShaderQuad',
    )?.args[0] as { params: Float32Array }
    expect(quad.params[19]).toBeCloseTo(3, 6)
  })

  it('hides the dots when collapsed or transparent', () => {
    const { node, dots } = build()
    node.outerScale = 0
    expect(dots.visible).toBe(false)
    node.outerScale = 1
    node.outerAlpha = 0
    expect(dots.visible).toBe(false)
  })
})
