import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Node2D } from './Node2D'
import { DraggableBehavior, type DraggableOptions } from './DraggableBehavior'
import type { PointerEvent2D } from '../input/PointerState'

// A drop target keyed by a column, deliberately returned as a fresh object each
// call so the `equals`-based dedup in onDragMove is exercised.
interface Cell {
  c: number
}

const ev = (x: number, y: number, id = 1): PointerEvent2D =>
  ({ pointer: { id, world: { x, y } } }) as unknown as PointerEvent2D

interface Scene {
  home: Node2D
  drag: Node2D
  card: Node2D
  behavior: DraggableBehavior<Cell>
  tween: ReturnType<typeof vi.fn>
  settleSnap: () => void
}

const setup = (opts: Partial<DraggableOptions<Cell>> = {}): Scene => {
  const home = new Node2D('home')
  const drag = new Node2D('drag')
  const card = new Node2D('card')
  card.transform.x = 10
  card.transform.y = 20
  home.add(card)

  // `tween` needs an engine-owned scene; stub it so the snap-back can start
  // without one. Default: a pending promise so the snap stays "in flight".
  let resolveSnap: (() => void) | null = null
  const tween = vi.fn(
    () =>
      new Promise<void>((res) => {
        resolveSnap = res
      }),
  )
  ;(card as { tween: unknown }).tween = tween

  const behavior = new DraggableBehavior<Cell>({
    dragLayer: drag,
    findDropTarget: (w) => (w.x < 100 ? null : { c: Math.floor(w.x / 100) }),
    equals: (a, b) => a.c === b.c,
    ...opts,
  })
  card.addBehavior(behavior)
  return {
    home,
    drag,
    card,
    behavior,
    tween,
    settleSnap: () => resolveSnap?.(),
  }
}

const down = (s: Scene, x: number, y: number): void =>
  s.card.onPointerDown?.(ev(x, y))
const move = (s: Scene, x: number, y: number): void =>
  s.card.onPointerMove?.(ev(x, y))
const up = (s: Scene, x: number, y: number): void =>
  s.card.onPointerUp?.(ev(x, y))

describe('DraggableBehavior', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('treats a sub-threshold press as a tap, not a drag', () => {
    const onTap = vi.fn()
    const onDragStart = vi.fn()
    const s = setup({ onTap, onDragStart })
    down(s, 50, 50)
    up(s, 53, 52) // moved < 8px
    expect(onTap).toHaveBeenCalledTimes(1)
    expect(onDragStart).not.toHaveBeenCalled()
    expect(s.card.parent).toBe(s.home)
    expect(s.card.transform.x).toBe(10)
    expect(s.card.transform.y).toBe(20)
  })

  it('promotes past the threshold, reparents, and keeps the grab point under the finger', () => {
    const onDragStart = vi.fn()
    const s = setup({ onDragStart })
    // Card origin world is (10, 20); grab offset becomes (5, 8).
    down(s, 15, 28)
    move(s, 50, 60) // 40px travel → a drag
    expect(onDragStart).toHaveBeenCalledTimes(1)
    expect(s.card.parent).toBe(s.drag)
    const origin = s.card.localToWorld(0, 0)
    expect(origin.x).toBeCloseTo(45, 5) // 50 - grabX(5)
    expect(origin.y).toBeCloseTo(52, 5) // 60 - grabY(8)
  })

  it('fires onDragMove only when the target changes, via equals', () => {
    const onDragMove = vi.fn()
    const s = setup({ onDragMove })
    down(s, 15, 28)
    move(s, 50, 60) // over nothing (x < 100): target null, no change from null
    move(s, 120, 60) // enters column 1
    move(s, 150, 60) // still column 1 (fresh object, equal by c) → no fire
    move(s, 260, 60) // enters column 2
    move(s, 50, 60) // leaves to nothing
    expect(onDragMove.mock.calls.map((c) => c[0])).toEqual([
      { c: 1 },
      { c: 2 },
      null,
    ])
  })

  it('drops on a target: reparents home, then onDrop + onSettled', () => {
    const onDrop = vi.fn()
    const onSettled = vi.fn()
    const s = setup({ onDrop, onSettled })
    down(s, 15, 28)
    move(s, 150, 60)
    up(s, 150, 60)
    expect(onDrop).toHaveBeenCalledWith({ c: 1 }, expect.anything())
    expect(onSettled).toHaveBeenCalledTimes(1)
    expect(s.card.parent).toBe(s.home)
    expect(s.card.transform.x).toBe(10)
    expect(s.card.transform.y).toBe(20)
  })

  it('cancels off-target at release and keeps the node in the drag layer during the snap', () => {
    const onDragCancel = vi.fn()
    const onSettled = vi.fn()
    const s = setup({ onDragCancel, onSettled })
    down(s, 15, 28)
    move(s, 50, 60) // dragging, over nothing
    up(s, 50, 60) // released off-target
    expect(onDragCancel).toHaveBeenCalledTimes(1)
    expect(s.tween).toHaveBeenCalledTimes(1)
    expect(s.card.parent).toBe(s.drag) // still lifted while snapping
    expect(s.behavior.isDragging).toBe(true)
    expect(onSettled).not.toHaveBeenCalled()
  })

  it('reparents home and settles when the snap-back finishes', async () => {
    const onSettled = vi.fn()
    const s = setup({ onSettled })
    down(s, 15, 28)
    move(s, 50, 60)
    up(s, 50, 60)
    s.settleSnap()
    await Promise.resolve()
    expect(onSettled).toHaveBeenCalledTimes(1)
    expect(s.card.parent).toBe(s.home)
    expect(s.behavior.isDragging).toBe(false)
  })

  it('settles synchronously when snapBack is off', () => {
    const onDragCancel = vi.fn()
    const onSettled = vi.fn()
    const s = setup({ snapBack: false, onDragCancel, onSettled })
    down(s, 15, 28)
    move(s, 50, 60)
    up(s, 50, 60)
    expect(onDragCancel).toHaveBeenCalledTimes(1)
    expect(s.tween).not.toHaveBeenCalled()
    expect(s.card.parent).toBe(s.home)
    expect(onSettled).toHaveBeenCalledTimes(1)
  })

  it('swallows the press when disabled', () => {
    const onDragStart = vi.fn()
    const onTap = vi.fn()
    const s = setup({ enabled: false, onDragStart, onTap })
    down(s, 15, 28)
    move(s, 80, 80)
    up(s, 80, 80)
    expect(onDragStart).not.toHaveBeenCalled()
    expect(onTap).not.toHaveBeenCalled()
    expect(s.card.parent).toBe(s.home)
  })

  it('re-grabs during a snap-back, aborting it and reusing the original home', () => {
    const onDrop = vi.fn()
    const s = setup({ onDrop })
    // First drag, released off-target → snap in flight, node in the drag layer.
    down(s, 15, 28)
    move(s, 50, 60)
    up(s, 50, 60)
    expect(s.card.parent).toBe(s.drag)
    // Re-grab mid-snap and drop on a real target.
    down(s, 50, 60)
    move(s, 150, 60)
    up(s, 150, 60)
    expect(onDrop).toHaveBeenCalledWith({ c: 1 }, expect.anything())
    // Home was preserved across the re-grab: back to the original slot.
    expect(s.card.parent).toBe(s.home)
    expect(s.card.transform.x).toBe(10)
    expect(s.card.transform.y).toBe(20)
  })
})
