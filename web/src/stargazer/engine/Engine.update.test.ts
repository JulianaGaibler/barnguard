import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Engine } from './Engine'
import { Node2D } from '../scene/Node2D'
import { Behavior } from '../scene/Behavior'
import { MockGfxDevice } from '../render/gfx/webgl2/mockGfxDevice'

// The update pass visits only the nodes with work, from a list kept by the
// tree. These pin what a game can rely on: tree order, a node's own update
// before its behaviours, and what happens to nodes added or destroyed while
// the pass runs.

class Logged extends Node2D {
  readonly log: string[]
  readonly onRun: (node: Logged) => void
  constructor(
    id: string,
    log: string[],
    onRun: (node: Logged) => void = () => {},
  ) {
    super(id)
    this.log = log
    this.onRun = onRun
  }
  override onUpdate(): void {
    this.log.push(this.id)
    this.onRun(this)
  }
}

class LogBehavior extends Behavior {
  readonly name: string
  readonly log: string[]
  constructor(name: string, log: string[]) {
    super()
    this.name = name
    this.log = log
  }
  override onUpdate(): void {
    this.log.push(this.name)
  }
}

function makeEngine(): Engine {
  return new Engine({
    canvas: document.createElement('canvas'),
    gpuDevice: new MockGfxDevice(),
  })
}

/** Run one frame and return what updated in it. */
function frame(log: string[]): string[] {
  log.length = 0
  vi.advanceTimersToNextFrame()
  return [...log]
}

describe('Engine update pass', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('updates in tree order, each node before its behaviours', () => {
    const engine = makeEngine()
    const log: string[] = []
    const a = new Logged('a', log)
    const b = new Logged('b', log)
    b.addBehavior(new LogBehavior('b-behavior', log))
    a.add(b)
    engine.tree.add(a, new Logged('c', log))
    engine.start()
    frame(log)
    expect(frame(log)).toEqual(['a', 'b', 'b-behavior', 'c'])
    engine.destroy()
  })

  it('still updates the sibling after a node that destroys itself', () => {
    const engine = makeEngine()
    const log: string[] = []
    engine.tree.add(
      new Logged('doomed', log, (n) => n.destroy()),
      new Logged('next', log),
    )
    engine.start()
    expect(frame(log)).toEqual(['doomed', 'next'])
    expect(frame(log)).toEqual(['next'])
    engine.destroy()
  })

  it('first updates a node added during the pass on the next frame', () => {
    const engine = makeEngine()
    const log: string[] = []
    let added = false
    engine.tree.add(
      new Logged('spawner', log, () => {
        if (added) return
        added = true
        engine.tree.add(new Logged('spawned', log))
      }),
    )
    engine.start()
    expect(frame(log)).toEqual(['spawner'])
    expect(frame(log)).toEqual(['spawner', 'spawned'])
    engine.destroy()
  })

  it('starts updating a node when it gains a behaviour', () => {
    const engine = makeEngine()
    const log: string[] = []
    const plain = new Node2D('plain')
    engine.tree.add(plain)
    engine.start()
    expect(frame(log)).toEqual([])
    plain.addBehavior(new LogBehavior('late', log))
    expect(frame(log)).toEqual(['late'])
    engine.destroy()
  })

  it('runs neither pass while paused', () => {
    const engine = makeEngine()
    const log: string[] = []
    const stepped = vi.fn()
    const node = new Logged('n', log)
    node.onFixedStep = stepped
    node._recomputeHasWork()
    engine.tree.add(node)
    engine.start()
    frame(log)
    frame(log)
    expect(stepped).toHaveBeenCalled()
    engine.setPaused(true)
    stepped.mockClear()
    expect(frame(log)).toEqual([])
    frame(log)
    expect(stepped).not.toHaveBeenCalled()
    engine.destroy()
  })
})
