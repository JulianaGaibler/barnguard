import { describe, expect, it } from 'vitest'
import {
  FLICK_SPEED_CELLS_PER_SEC,
  GestureRecognizer,
  SOFT_DROP_CELLS,
  TWIST_STEP_RAD,
  TWO_FINGER_TAP_MS,
  type GestureIntent,
} from './gestures'

const CELL = 40

/**
 * A recogniser with its output collected.
 *
 * Coordinates are in world units and times in milliseconds, both handed over
 * explicitly, because the whole point of the pure recogniser is that a stroke's
 * speed is something a test states rather than something it hopes for.
 */
function harness(): {
  g: GestureRecognizer
  intents: GestureIntent[]
  /** Every intent as a short tag, which is what most assertions want. */
  tags: () => string[]
} {
  const intents: GestureIntent[] = []
  const g = new GestureRecognizer({
    cell: () => CELL,
    emit: (i) => intents.push(i),
  })
  const tags = (): string[] =>
    intents.map((i) => {
      if (i.kind === 'rotate') return `rotate:${i.direction}`
      if (i.kind === 'softDrop') return `soft:${i.held ? 'on' : 'off'}`
      if (i.kind === 'dragBy') return `dragBy:${i.columns}`
      return i.kind
    })
  return { g, intents, tags }
}

/** Walk one finger from its anchor to a point over `ms`, in `steps` moves. */
function stroke(
  g: GestureRecognizer,
  id: number,
  from: { x: number; y: number; t: number },
  to: { x: number; y: number },
  ms: number,
  steps = 6,
): number {
  g.down(id, from.x, from.y, from.t)
  for (let i = 1; i <= steps; i++) {
    const f = i / steps
    g.move(
      id,
      from.x + (to.x - from.x) * f,
      from.y + (to.y - from.y) * f,
      from.t + ms * f,
    )
  }
  return from.t + ms
}

describe('tap', () => {
  it('turns the piece clockwise', () => {
    const { g, tags } = harness()
    g.down(1, 100, 100, 0)
    g.move(1, 101, 100, 20)
    g.up(1, 60)
    expect(tags()).toEqual(['rotate:cw'])
  })

  it('does not turn the piece when the finger travelled', () => {
    const { g, tags } = harness()
    const t = stroke(g, 1, { x: 100, y: 100, t: 0 }, { x: 300, y: 100 }, 300)
    g.up(1, t)
    expect(tags()).not.toContain('rotate:cw')
  })
})

describe('sideways drag', () => {
  it('slides by whole columns from where the finger went down', () => {
    const { g, intents } = harness()
    const t = stroke(
      g,
      1,
      { x: 100, y: 100, t: 0 },
      { x: 100 + CELL * 3, y: 100 },
      300,
    )
    g.up(1, t)
    const columns = intents
      .filter((i) => i.kind === 'dragBy')
      .map((i) => (i.kind === 'dragBy' ? i.columns : 0))
    expect(columns.at(-1)).toBe(3)
    expect(intents[0]).toEqual({ kind: 'dragStart' })
    expect(intents.at(-1)).toEqual({ kind: 'dragEnd' })
  })

  it('ignores a wobble smaller than the slop', () => {
    const { g, tags } = harness()
    const t = stroke(g, 1, { x: 100, y: 100, t: 0 }, { x: 110, y: 100 }, 200)
    g.up(1, t)
    expect(tags()).toEqual(['rotate:cw'])
  })
})

describe('downward stroke', () => {
  it('hard drops on a flick', () => {
    const { g, tags } = harness()
    // Six cells in 90ms, about 67 cells a second, which is a throw.
    const t = stroke(
      g,
      1,
      { x: 100, y: 100, t: 0 },
      { x: 100, y: 100 + CELL * 6 },
      90,
    )
    g.up(1, t)
    expect(tags()).toContain('hardDrop')
    expect(tags()).not.toContain('rotate:cw')
  })

  it('soft drops on a slow pull, and never hard drops', () => {
    const { g, tags } = harness()
    // The same six cells as the flick above, taken over a second and a half,
    // about four cells a second. Distance cannot tell these two apart.
    const t = stroke(
      g,
      1,
      { x: 100, y: 100, t: 0 },
      { x: 100, y: 100 + CELL * 6 },
      1500,
      30,
    )
    expect(tags()).toContain('soft:on')
    expect(tags()).not.toContain('hardDrop')
    g.up(1, t)
    expect(tags().at(-1)).toBe('soft:off')
  })

  it('releases the soft drop when the finger comes back up', () => {
    const { g, tags } = harness()
    g.down(1, 100, 100, 0)
    g.move(1, 100, 100 + CELL * (SOFT_DROP_CELLS + 1), 400)
    expect(tags()).toContain('soft:on')
    g.move(1, 100, 100 + CELL * (SOFT_DROP_CELLS - 1), 700)
    expect(tags().at(-1)).toBe('soft:off')
  })

  it('holds the soft drop while the finger also slides', () => {
    const { g, tags } = harness()
    g.down(1, 100, 100, 0)
    g.move(1, 100 + CELL * 2, 100 + CELL * 3, 500)
    // Both at once, because lining a piece up and pulling it down is one
    // motion for the player.
    expect(tags()).toContain('soft:on')
    expect(tags()).toContain('dragBy:2')
  })

  it('lets a flick finish a pull that is already soft dropping', () => {
    const { g, tags } = harness()
    g.down(1, 100, 100, 0)
    g.move(1, 100, 100 + CELL * 3, 600)
    expect(tags()).toContain('soft:on')
    g.move(1, 100, 100 + CELL * 9, 700)
    expect(tags()).toEqual(['soft:on', 'soft:off', 'hardDrop'])
  })

  it('is not tricked into a flick by a slow stroke that ends fast', () => {
    const { g, tags } = harness()
    g.down(1, 100, 100, 0)
    // Creep down, then one large jump that is only large because the browser
    // coalesced several moves. Speed is measured over the trail, so a single
    // late sample cannot manufacture a throw on its own.
    for (let i = 1; i <= 20; i++) g.move(1, 100, 100 + i * 4, i * 100)
    const before = tags().length
    g.move(1, 100, 100 + 20 * 4 + 6, 2100)
    expect(tags().slice(before)).not.toContain('hardDrop')
  })

  it('needs the stroke to be steeper than it is wide', () => {
    const { g, tags } = harness()
    // Fast, far, and diagonal. A throw across the buffer is a slide.
    const t = stroke(
      g,
      1,
      { x: 100, y: 100, t: 0 },
      { x: 100 + CELL * 6, y: 100 + CELL * 3 },
      90,
    )
    g.up(1, t)
    expect(tags()).not.toContain('hardDrop')
  })
})

describe('two fingers', () => {
  const pair = (g: GestureRecognizer, t = 0): void => {
    g.down(1, 100, 200, t)
    g.down(2, 300, 200, t + 20)
  }

  /**
   * Swing finger 2 around finger 1 far enough to turn the piece `steps` times.
   *
   * Sampled finely, so the sweep crosses each boundary rather than jumping it,
   * and overshot by half a step, so no sample lands exactly on a boundary where
   * a float decides the count. A hand never stops on one either.
   */
  const swing = (g: GestureRecognizer, steps: number): void => {
    const radius = 200
    const samples = 12
    const total = TWIST_STEP_RAD * (steps + Math.sign(steps) * 0.5)
    for (let i = 1; i <= samples; i++) {
      const angle = (total / samples) * i
      g.move(
        2,
        100 + Math.cos(angle) * radius,
        200 + Math.sin(angle) * radius,
        20 + i * 20,
      )
    }
  }

  it('turns the piece anticlockwise on a tap', () => {
    const { g, tags } = harness()
    pair(g)
    g.up(1, 150)
    expect(tags()).toEqual(['rotate:ccw'])
  })

  it('turns once, not once per finger', () => {
    const { g, tags } = harness()
    pair(g)
    g.up(1, 150)
    g.up(2, 190)
    expect(tags()).toEqual(['rotate:ccw'])
  })

  it('turns the way the pair twists, and again as it keeps going', () => {
    const { g, tags } = harness()
    pair(g)
    // Swing the second finger around the first, through exactly three steps.
    swing(g, 3)
    expect(tags().filter((x) => x === 'rotate:cw').length).toBe(3)
    expect(tags()).not.toContain('rotate:ccw')
  })

  it('turns the other way for the other twist', () => {
    const { g, tags } = harness()
    pair(g)
    swing(g, -2)
    expect(tags()).toEqual(['rotate:ccw', 'rotate:ccw'])
  })

  it('does not also tap on release after a twist', () => {
    const { g, tags } = harness()
    pair(g)
    swing(g, 2)
    const during = tags().length
    g.up(1, 200)
    expect(tags().length).toBe(during)
  })

  it('does nothing for a two-finger pan', () => {
    const { g, tags } = harness()
    pair(g)
    // Both fingers travel together, so the angle between them never changes.
    for (let i = 1; i <= 8; i++) {
      g.move(1, 100 + i * 20, 200, 20 + i * 20)
      g.move(2, 300 + i * 20, 200, 25 + i * 20)
    }
    g.up(1, 300)
    g.up(2, 320)
    expect(tags()).toEqual([])
  })

  it('does nothing for a rest that outstays the tap window', () => {
    const { g, tags } = harness()
    pair(g)
    g.move(1, 101, 200, TWO_FINGER_TAP_MS + 200)
    g.up(1, TWO_FINGER_TAP_MS + 400)
    expect(tags()).toEqual([])
  })

  it('does nothing for a long rest that never moves at all', () => {
    // Two fingers perfectly still send no moves, so the release time is the
    // only thing standing between a rest and a tap.
    const { g, tags } = harness()
    pair(g)
    g.up(1, TWO_FINGER_TAP_MS + 400)
    expect(tags()).toEqual([])
  })

  it('ignores a thumb landing partway through a drag', () => {
    const { g, tags } = harness()
    stroke(g, 1, { x: 100, y: 200, t: 0 }, { x: 100 + CELL * 3, y: 200 }, 300)
    const during = tags().length
    g.down(2, 400, 200, 320)
    g.up(2, 360)
    // The fumble does nothing, and it does not turn the drag into a tap.
    expect(tags().length).toBe(during)
    g.up(1, 400)
    expect(tags().at(-1)).toBe('dragEnd')
  })

  it('does not let the finger left behind start a new gesture', () => {
    const { g, tags } = harness()
    pair(g)
    g.up(1, 150)
    expect(tags()).toEqual(['rotate:ccw'])
    // The other finger is still down. Dragging it must not move the piece,
    // and lifting it must not turn the piece again.
    g.move(2, 300 + CELL * 4, 200, 300)
    g.up(2, 400)
    expect(tags()).toEqual(['rotate:ccw'])
  })

  it('does not let the first finger carry on when the second lifts first', () => {
    // The same rule, and the case that actually needs the lock: the finger
    // still down is the one the recogniser was treating as primary.
    const { g, tags } = harness()
    pair(g)
    g.up(2, 150)
    expect(tags()).toEqual(['rotate:ccw'])
    g.move(1, 100 + CELL * 4, 200, 300)
    g.up(1, 400)
    expect(tags()).toEqual(['rotate:ccw'])
  })

  it('starts clean once every finger is up', () => {
    const { g, tags } = harness()
    pair(g)
    g.up(1, 150)
    g.up(2, 190)
    g.down(1, 100, 100, 400)
    g.up(1, 450)
    expect(tags()).toEqual(['rotate:ccw', 'rotate:cw'])
  })
})

describe('interruptions', () => {
  it('ends a soft drop that a cancel takes away', () => {
    const { g, tags } = harness()
    g.down(1, 100, 100, 0)
    g.move(1, 100, 100 + CELL * 4, 600)
    g.cancel(1)
    expect(tags()).toEqual(['soft:on', 'soft:off'])
  })

  it('ends a drag that a cancel takes away, without turning the piece', () => {
    const { g, tags } = harness()
    stroke(g, 1, { x: 100, y: 100, t: 0 }, { x: 100 + CELL * 2, y: 100 }, 300)
    g.cancel(1)
    expect(tags().at(-1)).toBe('dragEnd')
    expect(tags()).not.toContain('rotate:cw')
  })

  it('lets go of everything on reset', () => {
    const { g, tags } = harness()
    g.down(1, 100, 100, 0)
    g.move(1, 100 + CELL * 2, 100 + CELL * 4, 600)
    expect(g.active).toBe(true)
    g.reset()
    expect(g.active).toBe(false)
    expect(tags().at(-2)).toBe('soft:off')
    expect(tags().at(-1)).toBe('dragEnd')
    // Nothing is left behind, so the next finger down is a fresh tap.
    g.down(1, 100, 100, 900)
    g.up(1, 950)
    expect(tags().at(-1)).toBe('rotate:cw')
  })

  it('ignores a pointer it never saw go down', () => {
    const { g, tags } = harness()
    g.move(9, 100, 400, 100)
    g.up(9, 200)
    expect(tags()).toEqual([])
  })
})

describe('the flick threshold', () => {
  /** Peak speed of a straight downward stroke of `cells` over `ms`. */
  const drop = (cells: number, ms: number): string[] => {
    const { g, tags } = harness()
    stroke(
      g,
      1,
      { x: 100, y: 100, t: 0 },
      { x: 100, y: 100 + CELL * cells },
      ms,
      12,
    )
    return tags()
  }

  it('sits between a pull and a throw', () => {
    // Stated as rates rather than as the constant, so the test still means
    // something if the constant moves.
    const fast = 30
    const slow = 5
    expect(fast).toBeGreaterThan(FLICK_SPEED_CELLS_PER_SEC)
    expect(slow).toBeLessThan(FLICK_SPEED_CELLS_PER_SEC)
    expect(drop(6, (6 / fast) * 1000)).toContain('hardDrop')
    expect(drop(6, (6 / slow) * 1000)).not.toContain('hardDrop')
  })
})
