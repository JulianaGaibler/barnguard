import { describe, expect, it } from 'vitest'
import type { Gfx2D } from '@src/stargazer'
import { ConfettiNode } from './ConfettiNode'
import type { BurstSpec } from '../flourish'

// One node holds every burst the table throws, so the thing worth pinning is
// that two bursts alive at the same moment keep their own physics. The base
// class takes gravity and drag per node, which would have made one node one
// feel, and `updateExtra` is what buys them back per particle.

const AT = { x: 100, y: 200 }

function spec(over: Partial<BurstSpec> = {}): BurstSpec {
  return {
    x: AT.x,
    y: AT.y,
    count: 4,
    spread: 0,
    speed: [0, 0],
    size: [10, 10],
    life: [1, 1],
    gravity: 0,
    damp: 0,
    flutter: 0,
    palette: ['#ffffff'],
    ...over,
  }
}

/** The camera `draw` wants. Its concrete type is not on the public barrel. */
type DrawCamera = Parameters<NonNullable<ConfettiNode['draw']>>[1]

interface Drawn {
  at: { x: number; y: number }
  alpha: number
  radius: number
}

/**
 * Records what each particle drew. The base class translates to a particle's
 * position before handing over, so this is also how a test reads positions off
 * a node that keeps them private.
 */
function render(node: ConfettiNode): Drawn[] {
  const out: Drawn[] = []
  let at = { x: 0, y: 0 }
  let alpha = 1
  const gfx = {
    save: () => {},
    restore: () => {},
    rotate: () => {},
    scale: () => {},
    translate: (x: number, y: number) => {
      at = { x, y }
    },
    setAlpha: (a: number) => {
      alpha = a
    },
    fillCircle: (_cx: number, _cy: number, r: number) => {
      out.push({ at, alpha, radius: r })
    },
  } as unknown as Gfx2D
  node.draw?.(gfx, {} as DrawCamera, 0)
  return out
}

describe('ConfettiNode', () => {
  it('throws the pieces a burst asks for, from where it happened', () => {
    const node = new ConfettiNode()
    node.play(spec({ count: 6 }))
    expect(node.aliveCount).toBe(6)
    for (const piece of render(node)) expect(piece.at).toEqual(AT)
  })

  // The mouth is over 400px across, so a puff from its centre point reads as a
  // pinprick under it.
  it('launches across a strip when a burst asks for one', () => {
    const node = new ConfettiNode()
    node.play(spec({ count: 40, spawnWidth: 300 }))
    const xs = render(node).map((p) => p.at.x)
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(150)
    for (const x of xs) expect(Math.abs(x - AT.x)).toBeLessThanOrEqual(150)
  })

  it('drops pieces rather than growing past its pool', () => {
    const node = new ConfettiNode()
    node.play(spec({ count: 5000 }))
    expect(node.aliveCount).toBeGreaterThan(0)
    expect(node.aliveCount).toBeLessThan(5000)
  })

  // The node outlives a round, so a win quit out of mid-burst would otherwise
  // keep raining confetti on the menu.
  it('drops everything at once when the table is taken down', () => {
    const node = new ConfettiNode()
    node.play(spec({ count: 6 }))
    node.clear()
    expect(node.aliveCount).toBe(0)
    expect(render(node)).toHaveLength(0)
  })

  it('clears a piece once its life runs out', () => {
    const node = new ConfettiNode()
    node.play(spec({ life: [0.2, 0.2] }))
    node.onUpdate(0.1)
    expect(node.aliveCount).toBe(4)
    node.onUpdate(0.2)
    expect(node.aliveCount).toBe(0)
  })

  it('fades a piece out over the end of its life', () => {
    const node = new ConfettiNode()
    node.play(spec({ life: [1, 1] }))
    expect(render(node)[0]!.alpha).toBe(1)
    node.onUpdate(0.9)
    expect(render(node)[0]!.alpha).toBeLessThan(1)
  })

  // The reason this is not a baked emitter, half of it: one node has to hold a
  // heavy shatter and a weightless float at the same moment.
  it('gives each burst its own gravity', () => {
    const node = new ConfettiNode()
    node.play(spec({ count: 1, gravity: 1000 }))
    node.play(spec({ count: 1, gravity: -1000 }))
    // Twice: the base integrates position before `updateExtra`, so a piece's
    // own gravity reaches its position on the frame after it is applied.
    node.onUpdate(0.1)
    node.onUpdate(0.1)
    const ys = render(node).map((p) => p.at.y)
    expect(Math.max(...ys)).toBeGreaterThan(AT.y)
    expect(Math.min(...ys)).toBeLessThan(AT.y)
  })

  it('gives each burst its own drag', () => {
    const node = new ConfettiNode()
    node.play(spec({ count: 1, speed: [500, 500], damp: 0 }))
    node.play(spec({ count: 1, speed: [500, 500], damp: 12 }))
    for (let i = 0; i < 8; i++) node.onUpdate(0.025)
    const travelled = render(node)
      .map((p) => Math.hypot(p.at.x - AT.x, p.at.y - AT.y))
      .sort((a, b) => a - b)
    expect(travelled[0]).toBeLessThan(travelled[1]! * 0.75)
  })

  // Paper wanders sideways as it falls. Applied to position rather than
  // velocity, so drag cannot flatten it out just as the piece slows down.
  it('flutters a piece sideways without touching a plain one', () => {
    const node = new ConfettiNode()
    node.play(spec({ count: 1, flutter: 400 }))
    node.play(spec({ count: 1, flutter: 0 }))
    for (let i = 0; i < 12; i++) node.onUpdate(1 / 60)
    const drift = render(node)
      .map((p) => Math.abs(p.at.x - AT.x))
      .sort((a, b) => a - b)
    expect(drift[0]).toBe(0)
    expect(drift[1]).toBeGreaterThan(0)
  })

  it('draws a piece as a disc of the size it was given', () => {
    const node = new ConfettiNode()
    node.play(spec({ count: 3, size: [24, 24] }))
    const drawn = render(node)
    expect(drawn).toHaveLength(3)
    for (const piece of drawn) expect(piece.radius).toBe(12)
  })
})
