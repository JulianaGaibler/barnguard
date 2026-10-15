import { describe, expect, it } from 'vitest'
import { ParticleEmitterNode } from './ParticleEmitterNode'
import { paintCalls } from '../render/picture/paintCalls'

type LoggedCall = readonly [string, ...unknown[]]

/** The calls this suite cares about, as the node paints them. */
function paint(node: ParticleEmitterNode): LoggedCall[] {
  return paintCalls(node).map((c): LoggedCall => [
    c.name,
    ...(c.name === 'drawImage' ? c.args.slice(1, 5) : c.args),
  ])
}

const SQUARE_CONFIG = {
  capacity: 10,
  ratePerSec: 0,
  lifetimeSec: [10, 10] as const,
  speedWorld: [100, 100] as const,
  spreadRad: 0,
  emitDirectionRad: 0,
  sizeWorld: [20, 20] as const,
  palette: ['#ffffff'],
} as const

describe('ParticleEmitterNode paint', () => {
  it('takes the bare drawImage path when spinRadPerSec is unset (fast path preserved)', () => {
    const node = new ParticleEmitterNode({ config: { ...SQUARE_CONFIG } })
    node.emitter.burst(1, 0, 0)
    const calls = paint(node)
    // Outer save/setBlend/restore, plus one bare drawImage call, with no
    // per-particle save/translate/rotate pair.
    expect(calls.filter((c) => c[0] === 'save').length).toBe(1)
    expect(calls.filter((c) => c[0] === 'rotate').length).toBe(0)
    expect(calls.filter((c) => c[0] === 'translate').length).toBe(0)
    const drawImageCalls = calls.filter((c) => c[0] === 'drawImage')
    expect(drawImageCalls.length).toBe(1)
    // dx = x - half = 0 - 10 = -10, dw = 20 (full life, scaleOverLife default 1)
    expect(drawImageCalls[0]).toEqual(['drawImage', -10, -10, 20, 20])
  })

  it('applies save/translate/rotate/drawImage/restore per particle when spin is set and angle is nonzero', () => {
    const node = new ParticleEmitterNode({
      config: { ...SQUARE_CONFIG, spinRadPerSec: [2, 2] },
    })
    node.emitter.burst(1, 0, 0)
    node.emitter.update(1) // angle: 0 -> 2
    const calls = paint(node)
    // Outer save plus one inner per-particle save is 2, with matching restores.
    expect(calls.filter((c) => c[0] === 'save').length).toBe(2)
    expect(calls.filter((c) => c[0] === 'restore').length).toBe(2)
    const rotateCalls = calls.filter((c) => c[0] === 'rotate')
    expect(rotateCalls.length).toBe(1)
    expect(rotateCalls[0][1]).toBeCloseTo(2, 5)
    const translateCalls = calls.filter((c) => c[0] === 'translate')
    expect(translateCalls.length).toBe(1)
  })

  it('does not rotate a particle whose angle is still exactly 0, even with spin configured', () => {
    const node = new ParticleEmitterNode({
      config: { ...SQUARE_CONFIG, spinRadPerSec: [2, 2] },
    })
    node.emitter.burst(1, 0, 0) // angle starts at 0, no update() yet
    const calls = paint(node)
    expect(calls.filter((c) => c[0] === 'rotate').length).toBe(0)
  })

  it('scaleBy: "speed" drives the drawn size by the current/launch speed ratio, not life', () => {
    const node = new ParticleEmitterNode({
      config: {
        ...SQUARE_CONFIG,
        lifetimeSec: [100, 100], // life-driven size would stay ~unchanged
        dampingPerSec: Math.log(4), // v *= 1/4 per second
        scaleBy: 'speed',
        scaleOverLife: [1, 0],
      },
    })
    node.emitter.burst(1, 0, 0) // speed0 = 100
    node.emitter.update(1) // v = 25 -> speedRatio = 0.25 -> t = 0.75
    const calls = paint(node)
    const [, , , dw, dh] = calls.find((c) => c[0] === 'drawImage')!
    // scale = 1 + (0-1)*0.75 = 0.25 -> size = 20*0.25 = 5
    expect(dw as number).toBeCloseTo(5, 3)
    expect(dh as number).toBeCloseTo(5, 3)
  })

  it('alpha still fades on the lifetime clock even when scale is speed-driven', () => {
    const node = new ParticleEmitterNode({
      config: {
        ...SQUARE_CONFIG,
        lifetimeSec: [2, 2],
        scaleBy: 'speed',
        scaleOverLife: [1, 1], // isolate alpha from the scale curve
        alphaOverLife: [1, 0],
      },
    })
    node.emitter.burst(1, 0, 0)
    node.emitter.update(1) // half of a 2s life elapsed -> alpha ~0.5
    const calls = paint(node)
    const alphaCalls = calls.filter((c) => c[0] === 'setAlpha')
    expect(alphaCalls.length).toBe(1)
    expect(alphaCalls[0][1] as number).toBeCloseTo(0.5, 3)
  })
})
