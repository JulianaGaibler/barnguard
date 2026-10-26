import { describe, expect, it } from 'vitest'
import type { ProgressMark } from '../story/run'
import { TrailView, type Tweener } from './trailView'

/** Applies every tween at once, and records what was asked. */
function instant(): Tweener & { calls: number } {
  const engine = {
    calls: 0,
    tween<T extends object>(target: T, to: Partial<T>): Promise<void> {
      engine.calls++
      Object.assign(target, to)
      return Promise.resolve()
    },
  }
  return engine as unknown as Tweener & { calls: number }
}

const marks = (kinds: string, current = kinds.length - 1): ProgressMark[] =>
  [...kinds].map((k, i) => ({
    kind: k === 'm' ? 'moment' : 'step',
    current: i === current,
  }))

/** Lets the promise chains inside the view settle. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('TrailView', () => {
  it('builds one mark per screen on the first sync, the last one filled', () => {
    const trail = new TrailView(instant())
    trail.sync(marks('sms'), 1664)
    expect(trail.count).toBe(3)
    expect(trail.markAt(0)?.shape).toBe('step')
    expect(trail.markAt(1)?.shape).toBe('moment')
    expect([0, 1, 2].map((i) => trail.markAt(i)?.filled)).toEqual([0, 0, 1])
  })

  it('places marks one mark and one link apart, pivoting on their centers', () => {
    const trail = new TrailView(instant())
    trail.sync(marks('sss'), 1664)
    const x = [0, 1, 2].map((i) => trail.markAt(i)!.transform.x)
    expect(x).toEqual([18, 70, 122])
    expect(trail.markAt(0)!.transform.y).toBe(18)
    expect(trail.markAt(0)!.transform.originX).toBe(18)
  })

  it('adds a mark at the end and hands the old current one back to a ring', () => {
    const trail = new TrailView(instant())
    trail.sync(marks('s'), 1664)
    trail.sync(marks('ss'), 1664)
    expect(trail.count).toBe(2)
    expect(trail.markAt(0)?.filled).toBe(0)
    expect(trail.markAt(1)?.filled).toBe(1)
  })

  it('can hold the new mark back until it is revealed', () => {
    const trail = new TrailView(instant())
    trail.sync(marks('s'), 1664)
    const held = trail.sync(marks('ss'), 1664, { holdLast: true })
    expect(held).toBe(trail.markAt(1))
    expect(held?.visible).toBe(false)
    trail.reveal(held!)
    expect(held?.visible).toBe(true)
    expect(held?.transform.scaleX).toBe(1)
  })

  it('returns nothing to hold when the row did not grow', () => {
    const trail = new TrailView(instant())
    trail.sync(marks('ss'), 1664)
    expect(trail.sync(marks('ss', 0), 1664, { holdLast: true })).toBeNull()
  })

  it('removes the last mark when the visitor goes back, and refills the one before', async () => {
    const trail = new TrailView(instant())
    trail.sync(marks('sss'), 1664)
    const gone = trail.markAt(2)!
    trail.sync(marks('ss'), 1664)
    await settle()
    expect(trail.count).toBe(2)
    expect(gone.isDestroyed).toBe(true)
    expect(trail.markAt(1)?.filled).toBe(1)
  })

  it('moves the current mark without adding one', () => {
    const trail = new TrailView(instant())
    trail.sync(marks('ss'), 1664)
    trail.sync(marks('ss', 0), 1664)
    expect(trail.markAt(0)?.filled).toBe(1)
    expect(trail.markAt(1)?.filled).toBe(0)
  })

  it('rebuilds a row that changed shape', () => {
    const trail = new TrailView(instant())
    trail.sync(marks('sss'), 1664)
    const before = trail.markAt(0)
    trail.sync(marks('m'), 1664)
    expect(trail.count).toBe(1)
    expect(trail.markAt(0)).not.toBe(before)
    expect(trail.markAt(0)?.shape).toBe('moment')
  })

  it('scales the whole row down once it outgrows its width, and back', () => {
    const trail = new TrailView(instant())
    trail.sync(marks('s'.repeat(60)), 1664)
    expect(trail.transform.scaleX).toBeLessThan(1)
    expect(trail.transform.scaleY).toBe(trail.transform.scaleX)
    trail.sync(marks('sss'), 1664)
    expect(trail.transform.scaleX).toBe(1)
  })

  it('draws nothing when nothing is shown', () => {
    const trail = new TrailView(instant())
    trail.sync([], 1664)
    expect(trail.count).toBe(0)
  })

  it('does not tween when told not to animate', () => {
    const engine = instant()
    const trail = new TrailView(engine)
    trail.sync(marks('s'), 1664)
    trail.sync(marks('ss'), 1664, { animate: false })
    expect(engine.calls).toBe(0)
  })

  it('creates a link between two marks and none before the first', () => {
    const trail = new TrailView(instant())
    trail.sync(marks('s'), 1664)
    // One mark, no link: only the mark is a child.
    expect(trail.children.length).toBe(1)
    trail.sync(marks('ss'), 1664, { animate: false })
    expect(trail.children.length).toBe(3)
  })
})
