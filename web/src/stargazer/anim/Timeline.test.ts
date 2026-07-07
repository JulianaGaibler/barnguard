import { describe, expect, it } from 'vitest'
import { Timeline } from './Timeline'

describe('Timeline', () => {
  it('runs steps in registration order', async () => {
    const order: number[] = []
    const t = new Timeline()
      .add(async () => {
        order.push(1)
      })
      .add(async () => {
        order.push(2)
      })
      .add(async () => {
        order.push(3)
      })
    await t.run()
    expect(order).toEqual([1, 2, 3])
  })

  it('parallel steps all resolve before the timeline advances', async () => {
    const order: string[] = []
    const t = new Timeline()
      .parallel(
        async () => {
          await Promise.resolve()
          order.push('a')
        },
        async () => {
          await Promise.resolve()
          await Promise.resolve()
          order.push('b')
        },
      )
      .add(async () => {
        order.push('c')
      })
    await t.run()
    expect(order).toContain('a')
    expect(order).toContain('b')
    expect(order[order.length - 1]).toBe('c')
  })

  it('throws AbortError between steps when the outer signal aborts', async () => {
    const ctrl = new AbortController()
    const order: number[] = []
    const t = new Timeline()
      .add(async () => {
        order.push(1)
        ctrl.abort()
      })
      .add(async () => {
        order.push(2)
      })
    await expect(t.run(ctrl.signal)).rejects.toMatchObject({
      name: 'AbortError',
    })
    expect(order).toEqual([1])
  })

  it('is empty when no steps were added', async () => {
    await new Timeline().run()
    // no throw = pass
    expect(true).toBe(true)
  })
})
