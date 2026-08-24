import { describe, expect, it, vi } from 'vitest'
import { Node2D } from './Node2D'
import {
  HoldButtonBehavior,
  type HoldButtonOptions,
} from './HoldButtonBehavior'
import type { PointerEvent2D } from '../input/PointerState'

const STEP = 1 / 120

const ev = (x: number, y: number, id = 1): PointerEvent2D =>
  ({ pointer: { id, world: { x, y } } }) as unknown as PointerEvent2D

const setup = (opts: Partial<HoldButtonOptions> = {}) => {
  const onPress = vi.fn()
  const node = new Node2D('hold')
  node.debugBounds = { x: 0, y: 0, width: 100, height: 100 }
  const behavior = new HoldButtonBehavior({ onPress, ...opts })
  node.addBehavior(behavior)
  return { node, behavior, onPress }
}

const down = (n: Node2D, x = 50, y = 50, id = 1): void =>
  n.onPointerDown?.(ev(x, y, id))
const up = (n: Node2D, x = 50, y = 50, id = 1): void =>
  n.onPointerUp?.(ev(x, y, id))

/** Advance the behavior's own clock, standing in for the engine's fixed step. */
const hold = (b: HoldButtonBehavior, seconds: number): void => {
  for (let t = 0; t < seconds - 1e-9; t += STEP) b.onFixedStep(STEP)
}

describe('HoldButtonBehavior', () => {
  it('fires on the press, not on the release', () => {
    const { node, onPress } = setup()
    down(node)
    expect(onPress).toHaveBeenCalledTimes(1)
    up(node)
    expect(onPress).toHaveBeenCalledTimes(1)
  })

  it('does not repeat without a repeat option', () => {
    const { node, behavior, onPress } = setup()
    down(node)
    hold(behavior, 2)
    expect(onPress).toHaveBeenCalledTimes(1)
  })

  it('waits out the delay, then repeats on the interval', () => {
    const { node, behavior, onPress } = setup({
      repeat: { delay: 0.2, interval: 0.05 },
    })
    down(node)
    expect(onPress).toHaveBeenCalledTimes(1)

    hold(behavior, 0.19)
    expect(onPress).toHaveBeenCalledTimes(1)

    // Crossing the delay fires the second press, then one per interval.
    hold(behavior, 0.02)
    expect(onPress).toHaveBeenCalledTimes(2)

    hold(behavior, 0.2)
    expect(onPress).toHaveBeenCalledTimes(6)
  })

  it('fires more than once per step for a sub-step interval', () => {
    const { node, behavior, onPress } = setup({
      repeat: { delay: STEP / 4, interval: STEP / 4 },
    })
    down(node)
    behavior.onFixedStep(STEP)
    expect(onPress).toHaveBeenCalledTimes(5) // the press plus four repeats
  })

  it('stops repeating on release and restarts the delay on the next press', () => {
    const { node, behavior, onPress } = setup({
      repeat: { delay: 0.2, interval: 0.05 },
    })
    down(node)
    hold(behavior, 0.25)
    const afterFirstHold = onPress.mock.calls.length
    up(node)

    hold(behavior, 1)
    expect(onPress).toHaveBeenCalledTimes(afterFirstHold)

    down(node)
    hold(behavior, 0.19)
    // The second press itself, and nothing more until the delay elapses again.
    expect(onPress).toHaveBeenCalledTimes(afterFirstHold + 1)
  })

  it('is inert while disabled', () => {
    const onPressedChange = vi.fn()
    const { node, behavior, onPress } = setup({
      enabled: false,
      onPressedChange,
      repeat: { delay: 0.1, interval: 0.05 },
    })
    down(node)
    hold(behavior, 1)
    expect(onPress).not.toHaveBeenCalled()
    expect(onPressedChange).not.toHaveBeenCalled()
  })

  it('releases the hold when enabled goes false mid-press', () => {
    let live = true
    const onPressedChange = vi.fn()
    const { node, behavior, onPress } = setup({
      enabled: () => live,
      onPressedChange,
      repeat: { delay: 0.1, interval: 0.05 },
    })
    down(node)
    hold(behavior, 0.15)
    expect(onPress.mock.calls.length).toBeGreaterThan(1)

    // A pause taken with the finger still down must not resume mid-repeat.
    live = false
    const atPause = onPress.mock.calls.length
    hold(behavior, 1)
    expect(onPress).toHaveBeenCalledTimes(atPause)
    expect(behavior.pressed).toBe(false)
    expect(onPressedChange).toHaveBeenLastCalledWith(false)

    live = true
    hold(behavior, 1)
    expect(onPress).toHaveBeenCalledTimes(atPause)
  })

  it('reports the pressed state and clears it on cancel', () => {
    const onPressedChange = vi.fn()
    const { node, behavior } = setup({ onPressedChange })
    down(node)
    expect(behavior.pressed).toBe(true)
    expect(onPressedChange).toHaveBeenLastCalledWith(true)

    node.onPointerCancel?.(ev(50, 50))
    expect(behavior.pressed).toBe(false)
    expect(onPressedChange).toHaveBeenLastCalledWith(false)
  })

  it('keeps repeating when the finger drifts off the node', () => {
    const { node, behavior, onPress } = setup({
      repeat: { delay: 0.1, interval: 0.05 },
    })
    down(node)
    node.onPointerMove?.(ev(500, 500))
    hold(behavior, 0.15)
    expect(onPress.mock.calls.length).toBeGreaterThan(1)
  })

  it('ignores a second pointer (singlePointer)', () => {
    const { node, onPress } = setup()
    down(node, 50, 50, 1)
    down(node, 60, 60, 2)
    expect(onPress).toHaveBeenCalledTimes(1)
  })

  it('clears the repeat clock when its node is destroyed', () => {
    const { node, behavior, onPress } = setup({
      repeat: { delay: 0.1, interval: 0.05 },
    })
    down(node)
    hold(behavior, 0.09)
    node.destroy()
    expect(behavior.pressed).toBe(false)

    hold(behavior, 1)
    expect(onPress).toHaveBeenCalledTimes(1)
  })
})
