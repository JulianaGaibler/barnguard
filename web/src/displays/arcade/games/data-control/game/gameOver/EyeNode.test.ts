import { describe, expect, it } from 'vitest'
import { paintCalls } from 'stargazer'
import { EyeNode } from './EyeNode'

function build(): EyeNode {
  return new EyeNode({
    outlinePath: new Path2D(),
    outlineBounds: { x: -10, y: -6, width: 20, height: 12 },
    irisRadius: 3,
    irisMaxOffset: 4,
    outlineFill: '#fff',
    irisFill: '#000',
  })
}

describe('EyeNode', () => {
  it('paints nothing while the lid is closed', () => {
    expect(paintCalls(build())).toEqual([])
  })

  it('slides the iris toward the look offset as focus rises', () => {
    const eye = build()
    eye.openAmount = 1
    eye.lookDx = 5
    eye.lookDy = 0
    const iris = () =>
      paintCalls(eye).find((c) => c.name === 'fillCircle')!.args as number[]
    expect(iris()[0]).toBe(0)
    eye.irisFocusAmount = 1
    expect(iris()[0]).toBeCloseTo(3)
    expect(iris()[1]).toBeCloseTo(0)
  })
})
