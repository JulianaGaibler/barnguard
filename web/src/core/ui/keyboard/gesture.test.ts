import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  HOLD_MS,
  KeyboardGesture,
  REPEAT_DELAY_MS,
  REPEAT_INTERVAL_MS,
  SLOP_PX,
  WATCHDOG_MS,
  type GestureHost,
  type GestureView,
  type PopupState,
  type Target,
} from './gesture'

const CELL = 10

// Keys sit side by side on y 0 to 10, 10 wide: a, s, backspace, enter.
const TARGETS: Target[] = [
  { id: 'a', action: { type: 'char', char: 'a' }, accents: ['ä', 'à', 'á'] },
  { id: 's', action: { type: 'char', char: 's' } },
  { id: 'bs', action: { type: 'backspace' } },
  { id: 'enter', action: { type: 'enter' } },
]
const keyX = (id: string): number =>
  TARGETS.findIndex((t) => t.id === id) * CELL + CELL / 2

function setup(initialLength = 5) {
  let length = initialLength
  const log: string[] = []
  let view: GestureView = { pressedIds: [], popup: null }
  const host: GestureHost = {
    hitTest: (x, y) =>
      y < 0 || y >= CELL ? null : (TARGETS[Math.floor(x / CELL)] ?? null),
    // The strip sits above the key, cells CELL wide from x 0.
    accentIndexAt: (popup: PopupState, x, y) =>
      y > CELL || y < -40 || x < 0 || x >= popup.cells.length * CELL
        ? null
        : Math.floor(x / CELL),
    type: (ch) => log.push(`type:${ch}`),
    backspace: () => {
      if (length === 0) return false
      length--
      log.push('backspace')
      return true
    },
    submit: () => log.push('submit'),
    close: () => log.push('close'),
    setPage: (page) => log.push(`page:${page}`),
    suggest: (word) => log.push(`suggest:${word}`),
    onChange: (next) => {
      view = next
    },
  }
  return { gesture: new KeyboardGesture(host), log, view: () => view }
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('tap', () => {
  it('shows the press and types on release', () => {
    const { gesture, log, view } = setup()
    gesture.down(1, keyX('s'), 5)
    expect(view().pressedIds).toEqual(['s'])
    expect(log).toEqual([])
    gesture.up(1, keyX('s'), 5)
    expect(log).toEqual(['type:s'])
    expect(view().pressedIds).toEqual([])
    expect(gesture.active).toBe(false)
  })

  it('ignores a press that lands between keys', () => {
    const { gesture, log } = setup()
    expect(gesture.down(1, keyX('s'), 50)).toBe(false)
    gesture.up(1, keyX('s'), 50)
    expect(log).toEqual([])
  })

  it('acts on the other keys on release', () => {
    const { gesture, log } = setup()
    gesture.down(1, keyX('enter'), 5)
    expect(log).toEqual([])
    gesture.up(1, keyX('enter'), 5)
    expect(log).toEqual(['submit'])
  })
})

describe('sliding', () => {
  it('types the key the finger ends on', () => {
    const { gesture, log, view } = setup()
    gesture.down(1, keyX('a'), 5)
    gesture.move(1, keyX('s'), 5, 1)
    expect(view().pressedIds).toEqual(['s'])
    gesture.up(1, keyX('s'), 5)
    expect(log).toEqual(['type:s'])
  })

  it('types nothing when lifted off the keys', () => {
    const { gesture, log, view } = setup()
    gesture.down(1, keyX('a'), 5)
    gesture.move(1, keyX('a'), 80, 1)
    expect(view().pressedIds).toEqual([])
    gesture.up(1, keyX('a'), 80)
    expect(log).toEqual([])
  })

  it('restarts the hold timer on the new key', () => {
    const { gesture, view } = setup()
    gesture.down(1, keyX('s'), 5)
    vi.advanceTimersByTime(HOLD_MS - 50)
    gesture.move(1, keyX('a'), 5, 1)
    vi.advanceTimersByTime(HOLD_MS - 50)
    expect(view().popup).toBeNull()
    vi.advanceTimersByTime(50)
    expect(view().popup?.keyId).toBe('a')
  })
})

describe('rollover', () => {
  it('types the first letter when a second finger lands', () => {
    const { gesture, log } = setup()
    gesture.down(1, keyX('a'), 5)
    gesture.down(2, keyX('s'), 5)
    expect(log).toEqual(['type:a'])
    gesture.up(1, keyX('a'), 5)
    gesture.up(2, keyX('s'), 5)
    expect(log).toEqual(['type:a', 'type:s'])
  })

  it('drops a held enter instead of firing it', () => {
    const { gesture, log } = setup()
    gesture.down(1, keyX('enter'), 5)
    gesture.down(2, keyX('s'), 5)
    gesture.up(1, keyX('enter'), 5)
    gesture.up(2, keyX('s'), 5)
    expect(log).toEqual(['type:s'])
  })
})

describe('hold for accents', () => {
  it('opens the strip with the plain letter highlighted', () => {
    const { gesture, view } = setup()
    gesture.down(1, keyX('a'), 5)
    vi.advanceTimersByTime(HOLD_MS)
    expect(view().popup).toEqual({
      keyId: 'a',
      cells: ['a', 'ä', 'à', 'á'],
      index: 0,
    })
  })

  it('types the plain letter when lifted without moving', () => {
    const { gesture, log, view } = setup()
    gesture.down(1, keyX('a'), 5)
    vi.advanceTimersByTime(HOLD_MS)
    gesture.up(1, keyX('a'), 5)
    expect(log).toEqual(['type:a'])
    expect(view().popup).toBeNull()
  })

  it('types the highlighted accent', () => {
    const { gesture, log, view } = setup()
    gesture.down(1, keyX('a'), 5)
    vi.advanceTimersByTime(HOLD_MS)
    gesture.move(1, 15, -20, 1)
    expect(view().popup?.index).toBe(1)
    gesture.up(1, 15, -20)
    expect(log).toEqual(['type:ä'])
  })

  it('keeps the plain letter highlighted through finger jitter', () => {
    const { gesture, log, view } = setup()
    gesture.down(1, keyX('a'), 5)
    vi.advanceTimersByTime(HOLD_MS)
    gesture.move(1, keyX('a') + SLOP_PX - 2, 5, 1)
    expect(view().popup?.index).toBe(0)
    gesture.up(1, keyX('a') + SLOP_PX - 2, 5)
    expect(log).toEqual(['type:a'])
  })

  it('types nothing when lifted outside the strip', () => {
    const { gesture, log, view } = setup()
    gesture.down(1, keyX('a'), 5)
    vi.advanceTimersByTime(HOLD_MS)
    gesture.move(1, 15, 60, 1)
    expect(view().popup?.index).toBeNull()
    gesture.up(1, 15, 60)
    expect(log).toEqual([])
  })

  it('is not offered on a key without accents', () => {
    const { gesture, view } = setup()
    gesture.down(1, keyX('s'), 5)
    vi.advanceTimersByTime(HOLD_MS * 3)
    expect(view().popup).toBeNull()
  })

  it('is not opened by a release before the hold time', () => {
    const { gesture, log, view } = setup()
    gesture.down(1, keyX('a'), 5)
    vi.advanceTimersByTime(HOLD_MS - 1)
    gesture.up(1, keyX('a'), 5)
    vi.advanceTimersByTime(HOLD_MS)
    expect(view().popup).toBeNull()
    expect(log).toEqual(['type:a'])
  })

  it('ignores other fingers while the strip is open', () => {
    const { gesture, log } = setup()
    gesture.down(1, keyX('a'), 5)
    vi.advanceTimersByTime(HOLD_MS)
    expect(gesture.down(2, keyX('s'), 5)).toBe(false)
    gesture.up(2, keyX('s'), 5)
    expect(log).toEqual([])
  })
})

describe('backspace', () => {
  it('deletes on press and repeats until release', () => {
    const { gesture, log } = setup(10)
    gesture.down(1, keyX('bs'), 5)
    expect(log).toEqual(['backspace'])
    vi.advanceTimersByTime(REPEAT_DELAY_MS)
    expect(log).toHaveLength(2)
    vi.advanceTimersByTime(REPEAT_INTERVAL_MS * 3)
    expect(log).toHaveLength(5)
    gesture.up(1, 500, 500)
    vi.advanceTimersByTime(1000)
    expect(log).toHaveLength(5)
  })

  it('stops on its own when the value is empty', () => {
    const { gesture, log } = setup(2)
    gesture.down(1, keyX('bs'), 5)
    vi.advanceTimersByTime(5000)
    expect(log).toEqual(['backspace', 'backspace'])
    gesture.up(1, keyX('bs'), 5)
  })

  it('does not delete again on release', () => {
    const { gesture, log } = setup()
    gesture.down(1, keyX('bs'), 5)
    gesture.up(1, keyX('bs'), 5)
    expect(log).toEqual(['backspace'])
  })
})

describe('lost releases', () => {
  it('types nothing on cancel and clears the press', () => {
    const { gesture, log, view } = setup()
    gesture.down(1, keyX('s'), 5)
    gesture.cancel(1)
    expect(log).toEqual([])
    expect(view().pressedIds).toEqual([])
    expect(gesture.active).toBe(false)
  })

  it('treats a move with no buttons as a lost release', () => {
    const { gesture, log, view } = setup()
    gesture.down(1, keyX('s'), 5)
    gesture.move(1, keyX('s'), 5, 0)
    expect(view().pressedIds).toEqual([])
    gesture.up(1, keyX('s'), 5)
    expect(log).toEqual([])
  })

  it('clears an open strip on reset', () => {
    const { gesture, log, view } = setup()
    gesture.down(1, keyX('a'), 5)
    vi.advanceTimersByTime(HOLD_MS)
    gesture.reset()
    expect(view().popup).toBeNull()
    expect(view().pressedIds).toEqual([])
    gesture.up(1, keyX('a'), 5)
    expect(log).toEqual([])
  })

  it('stops a repeating backspace on reset', () => {
    const { gesture, log } = setup(20)
    gesture.down(1, keyX('bs'), 5)
    gesture.reset()
    vi.advanceTimersByTime(2000)
    expect(log).toEqual(['backspace'])
  })

  it('drops a press that has gone quiet', () => {
    const { gesture, log, view } = setup()
    gesture.down(1, keyX('s'), 5)
    vi.advanceTimersByTime(WATCHDOG_MS)
    expect(view().pressedIds).toEqual([])
    expect(gesture.active).toBe(false)
    gesture.up(1, keyX('s'), 5)
    expect(log).toEqual([])
  })

  it('keeps a moving press alive past the watchdog time', () => {
    const { gesture, view } = setup()
    gesture.down(1, keyX('s'), 5)
    for (let i = 0; i < 4; i++) {
      vi.advanceTimersByTime(WATCHDOG_MS - 1000)
      gesture.move(1, keyX('s'), 5, 1)
    }
    expect(view().pressedIds).toEqual(['s'])
  })

  it('replaces a press whose release never came', () => {
    const { gesture, log } = setup()
    gesture.down(1, keyX('s'), 5)
    gesture.down(1, keyX('a'), 5)
    gesture.up(1, keyX('a'), 5)
    expect(log).toEqual(['type:a'])
  })
})
