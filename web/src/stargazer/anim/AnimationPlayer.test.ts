import { describe, expect, it } from 'vitest'
import { AnimationPlayer } from './AnimationPlayer'
import type { AnimationClip } from './AnimationClip'
import { Node3D } from '../scene/Node3D'

/** A 2-second clip translating `target` from x=0 to x=10, linearly. */
function translationClip(target: Node3D): AnimationClip {
  return {
    name: 'move',
    duration: 2,
    channels: [
      {
        target,
        path: 'translation',
        sampler: {
          input: new Float32Array([0, 2]),
          output: new Float32Array([0, 0, 0, 10, 0, 0]),
          interpolation: 'LINEAR',
        },
      },
    ],
  }
}

describe('AnimationPlayer', () => {
  it('ticks (onUpdate is a prototype method, so _hasUpdateWork is set)', () => {
    expect(new AnimationPlayer(null)._hasUpdateWork).toBe(true)
  })

  it('samples LINEAR translation into the target transform', () => {
    const target = new Node3D()
    const player = new AnimationPlayer(translationClip(target))
    player.onUpdate(1) // halfway through the 2s clip
    expect(target.transform.position.x).toBeCloseTo(5, 5)
  })

  it('wraps a looping clip past its end', () => {
    const target = new Node3D()
    const player = new AnimationPlayer(translationClip(target), { loop: true })
    player.onUpdate(2.5) // wraps to t=0.5 → x = 2.5
    expect(target.transform.position.x).toBeCloseTo(2.5, 5)
  })

  it('clamps a non-looping clip at its end', () => {
    const target = new Node3D()
    const player = new AnimationPlayer(translationClip(target), { loop: false })
    player.onUpdate(10)
    expect(target.transform.position.x).toBeCloseTo(10, 5)
  })

  it('holds the pose while paused', () => {
    const target = new Node3D()
    const player = new AnimationPlayer(translationClip(target), {
      autoplay: false,
    })
    player.onUpdate(1)
    expect(target.transform.position.x).toBe(0)
  })

  it('writes rotation via slerp, keeping the quaternion unit-length', () => {
    const target = new Node3D()
    const clip: AnimationClip = {
      name: 'spin',
      duration: 2,
      channels: [
        {
          target,
          path: 'rotation',
          sampler: {
            input: new Float32Array([0, 2]),
            // identity → 90° about Y (0, sin45, 0, cos45)
            output: new Float32Array([
              0,
              0,
              0,
              1,
              0,
              Math.SQRT1_2,
              0,
              Math.SQRT1_2,
            ]),
            interpolation: 'LINEAR',
          },
        },
      ],
    }
    const player = new AnimationPlayer(clip)
    player.onUpdate(1)
    const q = target.transform.rotation
    expect(Math.hypot(q.x, q.y, q.z, q.w)).toBeCloseTo(1, 5)
  })
})
