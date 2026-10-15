import { describe, expect, it, vi } from 'vitest'
import {
  IDLE_RETURN_MS,
  IDLE_WARN_MS,
  ScreenFlow,
  type FlowClock,
} from './screenFlow'

const SELECT_IDLE = IDLE_RETURN_MS.select!
const RESULT_IDLE = IDLE_RETURN_MS.gameOver!

/** A clock the test advances by hand. */
function manualClock(): FlowClock & { advance(ms: number): void } {
  let now = 0
  let nextId = 1
  const timers = new Map<number, { at: number; fn: () => void }>()
  return {
    set(fn, ms) {
      const id = nextId++
      timers.set(id, { at: now + ms, fn })
      return id
    },
    clear(handle) {
      timers.delete(handle as number)
    },
    advance(ms) {
      now += ms
      for (const [id, t] of [...timers]) {
        if (t.at <= now) {
          timers.delete(id)
          t.fn()
        }
      }
    },
  }
}

describe('ScreenFlow transitions', () => {
  it('walks the whole loop', () => {
    const flow = new ScreenFlow(manualClock())
    expect(flow.state).toBe('splash')
    flow.send('play')
    expect(flow.state).toBe('select')
    flow.send('pick')
    expect(flow.state).toBe('selected')
    flow.send('start')
    expect(flow.state).toBe('playing')
    flow.send('ended')
    expect(flow.state).toBe('gameOver')
    flow.send('continue')
    expect(flow.state).toBe('splash')
  })

  it('goes from the result back to the selected card on play again', () => {
    const flow = new ScreenFlow(manualClock())
    flow.send('play')
    flow.send('pick')
    flow.send('start')
    flow.send('ended')
    expect(flow.send('again')).toBe(true)
    expect(flow.state).toBe('selected')
  })

  it('backs out of selected to select', () => {
    const flow = new ScreenFlow(manualClock())
    flow.send('play')
    flow.send('pick')
    flow.send('back')
    expect(flow.state).toBe('select')
  })

  it('backs out of select to the splash', () => {
    const flow = new ScreenFlow(manualClock())
    flow.send('play')
    flow.send('back')
    expect(flow.state).toBe('splash')
  })

  it('ignores an event that is not legal on the current screen', () => {
    const flow = new ScreenFlow(manualClock())
    const listener = vi.fn()
    flow.onChange(listener)
    expect(flow.send('start')).toBe(false)
    expect(flow.send('pick')).toBe(false)
    expect(flow.state).toBe('splash')
    expect(listener).not.toHaveBeenCalled()
  })

  it('lets a stop go from a round or the result back to the splash', () => {
    const flow = new ScreenFlow(manualClock())
    flow.send('play')
    flow.send('pick')
    flow.send('start')
    expect(flow.send('abort')).toBe(true)
    expect(flow.state).toBe('splash')
  })

  it('reports each change once, with the previous screen', () => {
    const flow = new ScreenFlow(manualClock())
    const listener = vi.fn()
    flow.onChange(listener)
    flow.send('play')
    expect(listener).toHaveBeenCalledWith('select', 'splash')
  })

  it('treats a retarget as legal without announcing a change', () => {
    const flow = new ScreenFlow(manualClock())
    flow.send('play')
    flow.send('pick')
    const listener = vi.fn()
    flow.onChange(listener)
    expect(flow.send('pick')).toBe(true)
    expect(listener).not.toHaveBeenCalled()
  })
})

describe('ScreenFlow idle return', () => {
  it('returns to the splash from select after the idle time', () => {
    const clock = manualClock()
    const flow = new ScreenFlow(clock)
    flow.send('play')
    clock.advance(SELECT_IDLE - 1)
    expect(flow.state).toBe('select')
    clock.advance(1)
    expect(flow.state).toBe('splash')
  })

  it('restarts the clock on a touch', () => {
    const clock = manualClock()
    const flow = new ScreenFlow(clock)
    flow.send('play')
    clock.advance(SELECT_IDLE - 10)
    flow.touch()
    clock.advance(SELECT_IDLE - 10)
    expect(flow.state).toBe('select')
    clock.advance(10)
    expect(flow.state).toBe('splash')
  })

  it('restarts the clock when a pick retargets', () => {
    const clock = manualClock()
    const flow = new ScreenFlow(clock)
    flow.send('play')
    flow.send('pick')
    clock.advance(SELECT_IDLE - 10)
    flow.send('pick')
    clock.advance(SELECT_IDLE - 10)
    expect(flow.state).toBe('selected')
  })

  it('does not run while playing', () => {
    const clock = manualClock()
    const flow = new ScreenFlow(clock)
    flow.send('play')
    flow.send('pick')
    flow.send('start')
    clock.advance(SELECT_IDLE * 3)
    expect(flow.state).toBe('playing')
  })

  it('returns to the splash from the result too', () => {
    const clock = manualClock()
    const flow = new ScreenFlow(clock)
    flow.send('play')
    flow.send('pick')
    flow.send('start')
    flow.send('ended')
    clock.advance(RESULT_IDLE - 1)
    expect(flow.state).toBe('gameOver')
    clock.advance(1)
    expect(flow.state).toBe('splash')
  })

  it('stops the clock when destroyed', () => {
    const clock = manualClock()
    const flow = new ScreenFlow(clock)
    flow.send('play')
    flow.destroy()
    clock.advance(SELECT_IDLE * 2)
    expect(flow.state).toBe('select')
  })
})

describe('ScreenFlow idle warning', () => {
  it('warns before the return and stops when it happens', () => {
    const clock = manualClock()
    const flow = new ScreenFlow(clock)
    const seen: boolean[] = []
    flow.onWarning((w) => seen.push(w))
    flow.send('play')
    clock.advance(SELECT_IDLE - IDLE_WARN_MS - 1)
    expect(flow.warning).toBe(false)
    clock.advance(1)
    expect(flow.warning).toBe(true)
    clock.advance(IDLE_WARN_MS)
    expect(flow.state).toBe('splash')
    expect(flow.warning).toBe(false)
    expect(seen).toEqual([true, false])
  })

  it('takes the warning away on a touch', () => {
    const clock = manualClock()
    const flow = new ScreenFlow(clock)
    flow.send('play')
    clock.advance(SELECT_IDLE - IDLE_WARN_MS)
    expect(flow.warning).toBe(true)
    flow.touch()
    expect(flow.warning).toBe(false)
  })

  it('waits longer on the result than on the picker', () => {
    expect(RESULT_IDLE).toBeGreaterThan(SELECT_IDLE)
  })
})
