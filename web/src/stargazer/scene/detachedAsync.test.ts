/**
 * How every async engine call behaves when it has no engine to run on.
 *
 * This exists because getting it wrong is invisible. A node destroyed while an
 * async sequence is mid-flight used to reject with a plain `Error`, and
 * `ignoreAbort` RETHROWS anything that is not an abort, so the idiom the whole
 * codebase uses turned an ordinary teardown into an unhandled rejection that
 * killed the sequence silently. Nothing type-checks that, no existing test
 * covered it, and it only shows up as "the animation stopped" long after the
 * change that caused it.
 *
 * The rule, in one line: a DESTROYED owner rejects with `AbortError`, and an
 * owner that was never attached rejects with a plain `Error`.
 *
 * Every async API that can be reached from a node belongs in the table below.
 * Adding one without adding it here is the mistake this file is here to catch.
 */
import { describe, expect, it } from 'vitest'
import { ignoreAbort, isAbortError } from '../anim/abortSignal'
import { CameraNode2D } from '../camera/CameraNode2D'
import { CameraNode3D } from '../camera/CameraNode3D'
import { Node2D } from './Node2D'
import { Node3D } from './Node3D'
import { SceneTree } from './SceneTree'
import type { CameraHost } from '../camera/CameraHost'
import type { Engine } from '../engine/Engine'

/** Enough of an engine for the attach check and the animator hand-off. */
const fakeEngine = (): Engine =>
  ({
    animation: {
      wait: () => new Promise<void>(() => {}),
      tween: () => new Promise<void>(() => {}),
    },
  }) as unknown as Engine

/** One async call, and the node it hangs off. */
interface Case {
  name: string
  make: () => { node: { destroy(): void }; call: () => Promise<unknown> }
}

/** A camera node refuses to attach to a tree with no host to register with. */
const fakeStage = (): CameraHost =>
  ({
    registerCamera2D: () => {},
    unregisterCamera2D: () => {},
    setCurrentCamera2D: () => {},
    registerCamera3D: () => {},
    unregisterCamera3D: () => {},
    setCurrentCamera3D: () => {},
  }) as unknown as CameraHost

const attach = <T extends Node2D | Node3D>(node: T): T => {
  const tree = new SceneTree()
  tree.engine = fakeEngine()
  tree.stage = fakeStage()
  tree.root.add(node)
  return node
}

const CASES: Case[] = [
  {
    name: 'Node.wait',
    make: () => {
      const node = attach(new Node2D('n'))
      return { node, call: () => node.wait(1) }
    },
  },
  {
    name: 'Node.tweenTo',
    make: () => {
      const node = attach(new Node2D('n'))
      const target = { v: 0 }
      return {
        node,
        call: () => node.tweenTo(target, { v: 1 }, { duration: 1 }),
      }
    },
  },
  {
    name: 'Node2D.tween',
    make: () => {
      const node = attach(new Node2D('n'))
      return { node, call: () => node.tween({ x: 1 }, { duration: 1 }) }
    },
  },
  {
    name: 'Node3D.tween',
    make: () => {
      const node = attach(new Node3D('n'))
      return { node, call: () => node.tween({ alpha: 0 }, { duration: 1 }) }
    },
  },
  {
    name: 'CameraNode2D.animateTo',
    make: () => {
      const node = attach(new CameraNode2D('cam'))
      return {
        node,
        call: () => node.animateTo({ x: 0, y: 0, width: 10, height: 10 }),
      }
    },
  },
  {
    name: 'CameraNode3D.animateProjection',
    make: () => {
      const node = attach(new CameraNode3D('cam3'))
      return { node, call: () => node.animateProjection(1) }
    },
  },
]

describe.each(CASES.map((c) => [c.name, c] as const))(
  '%s on a destroyed node',
  (_name, testCase) => {
    it('rejects with an AbortError, not a plain Error', async () => {
      const { node, call } = testCase.make()
      node.destroy()
      await expect(call()).rejects.toSatisfy(isAbortError)
    })

    it('unwinds cleanly through ignoreAbort', async () => {
      // The idiom every caller uses. If this throws, a routine teardown
      // becomes an unhandled rejection and whatever was awaiting it dies.
      const { node, call } = testCase.make()
      node.destroy()
      await expect(call().catch(ignoreAbort)).resolves.toBeUndefined()
    })
  },
)

describe('an owner that was never attached', () => {
  it('still reports a plain Error, so a wiring mistake is loud', async () => {
    // The other half of the rule: silence here would hide a real bug.
    const node = new Node2D('orphan')
    await expect(node.wait(1)).rejects.toThrow(/not attached to an Engine/)
    await expect(node.wait(1)).rejects.not.toSatisfy(isAbortError)
  })

  it('rethrows out of ignoreAbort', async () => {
    const node = new Node2D('orphan')
    await expect(node.wait(1).catch(ignoreAbort)).rejects.toThrow(
      /not attached/,
    )
  })
})

describe('the table itself', () => {
  it('covers every async node API the engine exposes', () => {
    // A reminder rather than a real check: this number moving means a new
    // async call was added, and it needs a row above or it inherits the bug.
    expect(CASES).toHaveLength(6)
  })
})
