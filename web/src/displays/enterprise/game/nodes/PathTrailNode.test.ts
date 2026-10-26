import { describe, expect, it } from 'vitest'
import { PathTrailNode } from './PathTrailNode'

describe('PathTrailNode repaint', () => {
  it('repaints for new points and consumed points, and rests otherwise', () => {
    const trail = new PathTrailNode()
    trail.push(0, 0)
    trail.push(10, 0)
    trail.push(20, 0)
    trail._paintDirty = false
    trail.onUpdate(0.016)
    expect(trail._paintDirty).toBe(false)

    trail.push(30, 0)
    expect(trail._paintDirty).toBe(true)
    trail._paintDirty = false
    trail.markConsumed(0)
    expect(trail._paintDirty).toBe(true)
  })
})
