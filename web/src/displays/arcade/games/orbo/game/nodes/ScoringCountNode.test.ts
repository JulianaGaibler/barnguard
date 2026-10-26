import { describe, it, expect } from 'vitest'
import { paintCalls } from 'stargazer'
import { ScoringCountNode } from './ScoringCountNode'

function textCalls(node: ScoringCountNode) {
  return paintCalls(node, { deviceScale: 1 }).filter(
    (call) => call.name === 'fillText',
  )
}

describe('ScoringCountNode', () => {
  it('paints the current count centered, in the given color', () => {
    const node = new ScoringCountNode(() => 3, 100, 200, '#E24A4A')
    const calls = textCalls(node)
    expect(calls).toHaveLength(1)
    expect(calls[0].args[0]).toBe('3')
    expect(calls[0].args[3]).toMatchObject({
      align: 'center',
      baseline: 'middle',
      color: '#E24A4A',
    })
  })

  it('follows the count as it changes (live)', () => {
    let n = 0
    const node = new ScoringCountNode(() => n, 0, 0, '#000')
    expect(textCalls(node)[0].args[0]).toBe('0')
    n = 5
    node.onUpdate()
    expect(textCalls(node)[0].args[0]).toBe('5')
  })

  it('positions itself at the given anchor', () => {
    const node = new ScoringCountNode(() => 1, 100, 250, '#000')
    expect(node.transform.x).toBe(100)
    expect(node.transform.y).toBe(250)
  })
})
