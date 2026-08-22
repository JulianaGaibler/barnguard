import { describe, expect, it, vi } from 'vitest'
import { Node2D } from './Node2D'
import { ButtonBehavior, type ButtonOptions } from './ButtonBehavior'
import type { PointerEvent2D } from '../input/PointerState'

const ev = (x: number, y: number, id = 1): PointerEvent2D =>
  ({ pointer: { id, world: { x, y } } }) as unknown as PointerEvent2D

const setup = (opts: Partial<ButtonOptions> = {}) => {
  const onClick = vi.fn()
  const node = new Node2D('btn')
  node.debugBounds = { x: 0, y: 0, width: 100, height: 100 }
  node.addBehavior(new ButtonBehavior({ onClick, ...opts }))
  return { node, onClick }
}

const down = (n: Node2D, x: number, y: number, id = 1): void =>
  n.onPointerDown?.(ev(x, y, id))
const up = (n: Node2D, x: number, y: number, id = 1): void =>
  n.onPointerUp?.(ev(x, y, id))

describe('ButtonBehavior', () => {
  it('fires onClick when the release still hits the node', () => {
    const { node, onClick } = setup()
    down(node, 50, 50)
    up(node, 50, 50)
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('does not fire when the press is dragged off before release', () => {
    const { node, onClick } = setup()
    down(node, 50, 50)
    up(node, 200, 200)
    expect(onClick).not.toHaveBeenCalled()
  })

  it('is inert when disabled', () => {
    const onPressedChange = vi.fn()
    const { node, onClick } = setup({ enabled: false, onPressedChange })
    down(node, 50, 50)
    up(node, 50, 50)
    expect(onClick).not.toHaveBeenCalled()
    expect(onPressedChange).not.toHaveBeenCalled()
  })

  it('reports the pressed state and cancels without firing', () => {
    const onPressedChange = vi.fn()
    const { node, onClick } = setup({ onPressedChange })
    down(node, 50, 50)
    expect(onPressedChange).toHaveBeenLastCalledWith(true)
    node.onPointerCancel?.(ev(50, 50))
    expect(onPressedChange).toHaveBeenLastCalledWith(false)
    expect(onClick).not.toHaveBeenCalled()
  })

  it('ignores a second pointer (singlePointer)', () => {
    const { node, onClick } = setup()
    down(node, 50, 50, 1)
    down(node, 60, 60, 2) // dropped by the singlePointer wrapper
    up(node, 60, 60, 2) // not the tracked pointer
    up(node, 50, 50, 1)
    expect(onClick).toHaveBeenCalledTimes(1)
  })
})
