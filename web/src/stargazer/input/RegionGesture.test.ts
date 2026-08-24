/**
 * Which pointers a region binding follows, and which it turns away.
 *
 * The pointer stream is the whole stage's, so every binding sees every finger.
 * What makes a binding a REGION binding is the filtering, and that filtering
 * has to hold for the whole life of a pointer rather than only at its press: a
 * `move` for a finger that landed somewhere else is as wrong as a `down` would
 * have been.
 */
import { describe, expect, it } from 'vitest'
import { createEmitter } from '../events/Emitter'
import type { EngineEvents } from '../events/EngineEvents'
import type { Engine } from '../engine/Engine'
import { bindRegionGesture, type RegionGestureOptions } from './RegionGesture'
import type { PointerEvent2D } from './PointerState'

/** A stage-wide pointer stream, and a rig to drive it. */
function rig(
  opts: Omit<RegionGestureOptions, 'down' | 'move' | 'up' | 'cancel'>,
): {
  log: string[]
  off: () => void
  down: (id: number, x?: number, y?: number) => void
  move: (id: number, x?: number, y?: number) => void
  up: (id: number) => void
  cancel: (id: number) => void
} {
  const events = createEmitter<EngineEvents>()
  const engine = { events } as unknown as Engine
  const log: string[] = []

  const off = bindRegionGesture(engine, {
    ...opts,
    down: (e) => log.push(`down:${e.pointer.id}`),
    move: (e) => log.push(`move:${e.pointer.id}`),
    up: (e) => log.push(`up:${e.pointer.id}`),
    cancel: (e) => log.push(`cancel:${e.pointer.id}`),
    onReject: (e) => log.push(`reject:${e.pointer.id}`),
  })

  const send = (
    phase: 'pointerDown' | 'pointerMove' | 'pointerUp' | 'pointerCancel',
    id: number,
    x: number,
    y: number,
  ): void => {
    events.emit(phase, {
      pointer: { id, world: { x, y } },
    } as unknown as PointerEvent2D)
  }

  return {
    log,
    off,
    down: (id, x = 0, y = 0) => send('pointerDown', id, x, y),
    move: (id, x = 0, y = 0) => send('pointerMove', id, x, y),
    up: (id) => send('pointerUp', id, 0, 0),
    cancel: (id) => send('pointerCancel', id, 0, 0),
  }
}

/** Accepts presses on the left half of the world, like one seat of a race. */
const leftHalf = (w: { x: number }): boolean => w.x < 100

describe('a single-pointer region', () => {
  it('follows the first press and ignores the rest until it lifts', () => {
    const r = rig({})
    r.down(1)
    r.down(2)
    r.move(1)
    r.move(2)
    r.up(1)
    r.down(2)
    expect(r.log).toEqual(['down:1', 'move:1', 'up:1', 'down:2'])
  })

  it('does not follow a pointer whose press it turned away', () => {
    const r = rig({ hitTest: leftHalf })
    r.down(1, 500)
    r.move(1, 500)
    r.up(1)
    expect(r.log).toEqual(['reject:1'])
  })
})

describe('a multi-touch region', () => {
  const many = { singlePointer: false, hitTest: leftHalf }

  it('follows every pointer that landed on it', () => {
    const r = rig(many)
    r.down(1)
    r.down(2)
    r.move(1)
    r.move(2)
    r.up(2)
    r.up(1)
    expect(r.log).toEqual([
      'down:1',
      'down:2',
      'move:1',
      'move:2',
      'up:2',
      'up:1',
    ])
  })

  it('never hears from a pointer that landed somewhere else', () => {
    // The case a single shared stream makes easy to get wrong. In a race the
    // other player's whole half is "somewhere else", and their drags would
    // otherwise arrive here as moves with no press in front of them.
    const r = rig(many)
    r.down(1, 10)
    r.down(2, 900)
    r.move(2, 910)
    r.up(2)
    r.move(1, 20)
    r.up(1)
    expect(r.log).toEqual(['down:1', 'reject:2', 'move:1', 'up:1'])
  })

  it('lets a pointer go on cancel, so its later moves are ignored', () => {
    const r = rig(many)
    r.down(1)
    r.cancel(1)
    r.move(1)
    r.up(1)
    expect(r.log).toEqual(['down:1', 'cancel:1'])
  })

  it('turns away presses while the gate is shut, and takes them after', () => {
    let open = false
    const r = rig({ ...many, enabled: () => open })
    r.down(1)
    expect(r.log).toEqual(['reject:1'])
    open = true
    r.down(2)
    r.move(2)
    expect(r.log).toEqual(['reject:1', 'down:2', 'move:2'])
  })

  it('stops hearing anything once unbound', () => {
    const r = rig(many)
    r.down(1)
    r.off()
    r.move(1)
    r.up(1)
    r.down(2)
    expect(r.log).toEqual(['down:1'])
  })
})
