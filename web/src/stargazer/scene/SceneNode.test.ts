import { describe, expect, it } from 'vitest'
import { SceneNode } from './SceneNode'
import { Behavior } from './Behavior'
import { Scene } from './Scene'
import { Animator } from '../anim/Animator'
import type { Engine } from '../engine/Engine'
import type { PointerEvent2D } from '../input/PointerState'

/** Build a Scene with a working Animator on `scene.engine.animation`. */
function makeSceneWithAnimator(): { scene: Scene; animator: Animator } {
  const scene = new Scene()
  const animator = new Animator()
  scene.engine = { animation: animator } as unknown as Engine
  return { scene, animator }
}

class BehaviorA extends Behavior {}
class BehaviorB extends Behavior {}
class BehaviorC extends BehaviorA {}

describe('SceneNode', () => {
  it('destroy() aborts the abort signal', () => {
    const node = new SceneNode()
    expect(node.abortSignal.aborted).toBe(false)
    node.destroy()
    expect(node.abortSignal.aborted).toBe(true)
    expect(node.isDestroyed).toBe(true)
  })

  it('destroy() cascades to descendants', () => {
    const root = new SceneNode('root')
    const child = new SceneNode('child')
    const grandchild = new SceneNode('grandchild')
    child.add(grandchild)
    root.add(child)
    root.destroy()
    expect(root.isDestroyed).toBe(true)
    expect(child.isDestroyed).toBe(true)
    expect(grandchild.isDestroyed).toBe(true)
    expect(child.abortSignal.aborted).toBe(true)
    expect(grandchild.abortSignal.aborted).toBe(true)
  })

  it('destroy() emits destroy event', () => {
    const node = new SceneNode()
    let fired = false
    node.events.on('destroy', () => {
      fired = true
    })
    node.destroy()
    expect(fired).toBe(true)
  })

  it('destroy() removes itself from parent', () => {
    const parent = new SceneNode('p')
    const child = new SceneNode('c')
    parent.add(child)
    expect(parent.children.length).toBe(1)
    child.destroy()
    expect(parent.children.length).toBe(0)
  })

  it('getBehavior<T> returns the first matching instance', () => {
    const node = new SceneNode()
    const a = new BehaviorA()
    const b = new BehaviorB()
    node.addBehavior(a)
    node.addBehavior(b)
    expect(node.getBehavior(BehaviorA)).toBe(a)
    expect(node.getBehavior(BehaviorB)).toBe(b)
  })

  it('getBehavior<T> supports subclass polymorphism', () => {
    const node = new SceneNode()
    const c = new BehaviorC()
    node.addBehavior(c)
    // BehaviorC extends BehaviorA, lookup by BehaviorA returns it.
    expect(node.getBehavior(BehaviorA)).toBe(c)
    expect(node.getBehavior(BehaviorC)).toBe(c)
  })

  it('getBehaviors<T> returns all matches in insertion order', () => {
    const node = new SceneNode()
    const a1 = new BehaviorA()
    const a2 = new BehaviorA()
    const b = new BehaviorB()
    node.addBehavior(a1)
    node.addBehavior(b)
    node.addBehavior(a2)
    const found = node.getBehaviors(BehaviorA)
    expect(found).toEqual([a1, a2])
  })

  it('changing renderLayer to/from static invalidates the scene static cache', () => {
    const scene = new Scene()
    const node = new SceneNode()
    scene.root.add(node)
    scene.markStaticClean()
    expect(scene.staticInvalid).toBe(false)
    node.renderLayer = 'static'
    expect(scene.staticInvalid).toBe(true)
    scene.markStaticClean()
    node.renderLayer = 'dynamic'
    expect(scene.staticInvalid).toBe(true)
  })

  it('changing renderLayer between non-static values does NOT invalidate', () => {
    const scene = new Scene()
    const node = new SceneNode()
    node.renderLayer = 'dynamic'
    scene.root.add(node)
    scene.markStaticClean()
    node.renderLayer = 'above-static'
    expect(scene.staticInvalid).toBe(false)
  })

  it('adding a static-layer subtree invalidates static cache', () => {
    const scene = new Scene()
    scene.markStaticClean()
    const node = new SceneNode()
    node.renderLayer = 'static'
    scene.root.add(node)
    expect(scene.staticInvalid).toBe(true)
  })

  describe('_staticDescendantCount (P8)', () => {
    it('root count reflects a static grandchild added via a dynamic parent', () => {
      const root = new SceneNode('root')
      const mid = new SceneNode('mid')
      const leaf = new SceneNode('leaf')
      leaf.renderLayer = 'static'
      mid.add(leaf)
      // leaf is static → mid._staticDescendantCount === 1
      root.add(mid)
      // root sees mid's whole subtree total (1 static) → root._staticDescendantCount === 1
      root._verifyStaticCount()
    })

    it('changing a leaf to static propagates the count up to the root', () => {
      const root = new SceneNode('root')
      const mid = new SceneNode('mid')
      const leaf = new SceneNode('leaf')
      root.add(mid)
      mid.add(leaf)
      // No static nodes yet.
      root._verifyStaticCount()
      leaf.renderLayer = 'static'
      // Every ancestor sees leaf as a static descendant.
      root._verifyStaticCount()
    })

    it('changing a leaf back to dynamic decrements every ancestor', () => {
      const root = new SceneNode('root')
      const mid = new SceneNode('mid')
      const leaf = new SceneNode('leaf')
      root.add(mid)
      mid.add(leaf)
      leaf.renderLayer = 'static'
      root._verifyStaticCount()
      leaf.renderLayer = 'dynamic'
      root._verifyStaticCount()
    })

    it('removing a static-heavy subtree drops the ancestors count to zero', () => {
      const root = new SceneNode('root')
      const mid = new SceneNode('mid')
      const a = new SceneNode('a')
      const b = new SceneNode('b')
      a.renderLayer = 'static'
      b.renderLayer = 'static'
      mid.add(a)
      mid.add(b)
      root.add(mid)
      root._verifyStaticCount()
      root.remove(mid)
      root._verifyStaticCount()
      // Detached subtree itself is still internally consistent.
      mid._verifyStaticCount()
    })

    it('reparenting a static-heavy subtree moves the count between ancestors', () => {
      const root = new SceneNode('root')
      const leftBranch = new SceneNode('left')
      const rightBranch = new SceneNode('right')
      const staticSubtreeRoot = new SceneNode('staticRoot')
      const c1 = new SceneNode('c1')
      const c2 = new SceneNode('c2')
      c1.renderLayer = 'static'
      c2.renderLayer = 'static'
      staticSubtreeRoot.add(c1)
      staticSubtreeRoot.add(c2)
      root.add(leftBranch)
      root.add(rightBranch)
      leftBranch.add(staticSubtreeRoot)
      root._verifyStaticCount()
      // Reparent from left branch to right branch, no explicit remove
      // needed; add() detects the existing parent and detaches first.
      rightBranch.add(staticSubtreeRoot)
      root._verifyStaticCount()
    })

    it('destroy cascade leaves parents with a zero count', () => {
      const root = new SceneNode('root')
      const mid = new SceneNode('mid')
      const leaf = new SceneNode('leaf')
      leaf.renderLayer = 'static'
      mid.add(leaf)
      root.add(mid)
      mid.destroy()
      // After destroying mid, root has no static descendants.
      root._verifyStaticCount()
    })

    it('_verifyStaticCount throws on a drifted count (regression detector)', () => {
      const root = new SceneNode('root')
      const leaf = new SceneNode('leaf')
      leaf.renderLayer = 'static'
      root.add(leaf)
      // Manually corrupt the count to simulate drift.
      root._forceStaticDescendantCount(42)
      expect(() => root._verifyStaticCount()).toThrow(/drift/i)
    })
  })

  describe('Behavior.onSceneReady (C4)', () => {
    it('fires synchronously when the node is already scene-attached at addBehavior', () => {
      const scene = new Scene()
      const node = new SceneNode('n')
      scene.root.add(node)
      const seen: string[] = []
      class B extends Behavior {
        override onAttach(): void {
          seen.push('attach')
        }
        override onSceneReady(): void {
          seen.push('ready')
        }
      }
      node.addBehavior(new B())
      // Sync ordering: attach before ready, both before the next line.
      expect(seen).toEqual(['attach', 'ready'])
    })

    it('is deferred until scene attachment when node is standalone', () => {
      const node = new SceneNode('n')
      const seen: string[] = []
      class B extends Behavior {
        override onSceneReady(): void {
          seen.push('ready')
        }
      }
      node.addBehavior(new B())
      // Not yet attached, onSceneReady has NOT fired.
      expect(seen).toEqual([])
      const scene = new Scene()
      scene.root.add(node)
      // Attaching to a scene fires it.
      expect(seen).toEqual(['ready'])
    })

    it('fires only ONCE per addBehavior (detach + reattach does not refire)', () => {
      const scene = new Scene()
      const other = new Scene()
      const node = new SceneNode('n')
      scene.root.add(node)
      let readyCount = 0
      class B extends Behavior {
        override onSceneReady(): void {
          readyCount++
        }
      }
      node.addBehavior(new B())
      expect(readyCount).toBe(1)
      // Detach + re-attach to a different scene: onSceneReady should NOT refire.
      scene.root.remove(node)
      other.root.add(node)
      expect(readyCount).toBe(1)
    })

    it('removeBehavior + addBehavior again fires onSceneReady a second time', () => {
      const scene = new Scene()
      const node = new SceneNode('n')
      scene.root.add(node)
      let readyCount = 0
      class B extends Behavior {
        override onSceneReady(): void {
          readyCount++
        }
      }
      const b = new B()
      node.addBehavior(b)
      expect(readyCount).toBe(1)
      node.removeBehavior(b)
      node.addBehavior(b)
      expect(readyCount).toBe(2)
    })
  })

  describe('SceneNode.destroyChildren (C6)', () => {
    it('destroys every current child in a snapshot-safe cascade', () => {
      const parent = new SceneNode('p')
      const a = new SceneNode('a')
      const b = new SceneNode('b')
      const c = new SceneNode('c')
      parent.add(a)
      parent.add(b)
      parent.add(c)
      parent.destroyChildren()
      expect(a.isDestroyed).toBe(true)
      expect(b.isDestroyed).toBe(true)
      expect(c.isDestroyed).toBe(true)
      expect(parent.children.length).toBe(0)
      expect(parent.isDestroyed).toBe(false)
    })

    it('is safe to call with no children', () => {
      const node = new SceneNode('n')
      node.destroyChildren()
      expect(node.isDestroyed).toBe(false)
    })
  })

  describe('SceneNode.bindPointer (C5)', () => {
    it('assigns handlers and the unbind clears them', () => {
      const node = new SceneNode('n')
      const down = (): void => {}
      const move = (): void => {}
      const unbind = node.bindPointer({ down, move })
      expect(node.onPointerDown).toBe(down)
      expect(node.onPointerMove).toBe(move)
      unbind()
      expect(node.onPointerDown).toBeUndefined()
      expect(node.onPointerMove).toBeUndefined()
    })

    it('turns hitEnabled on when a down handler is provided', () => {
      const node = new SceneNode('n')
      expect(node.hitEnabled).toBe(false)
      const unbind = node.bindPointer({ down: () => {} })
      expect(node.hitEnabled).toBe(true)
      unbind()
      expect(node.hitEnabled).toBe(false)
    })

    it('respects hitEnabled: false override', () => {
      const node = new SceneNode('n')
      const unbind = node.bindPointer({ down: () => {}, hitEnabled: false })
      expect(node.hitEnabled).toBe(false)
      unbind()
    })

    it('unbind is idempotent', () => {
      const node = new SceneNode('n')
      const unbind = node.bindPointer({ down: () => {} })
      unbind()
      unbind()
      expect(node.onPointerDown).toBeUndefined()
    })
  })

  describe('SceneNode.tweenTo (C2)', () => {
    it('tweens numeric fields on an arbitrary target', async () => {
      const { scene, animator } = makeSceneWithAnimator()
      const node = new SceneNode('n')
      scene.root.add(node)
      const target = { customAlpha: 0 }
      const p = node.tweenTo(target, { customAlpha: 1 }, { duration: 1 })
      animator.tick(0.5)
      expect(target.customAlpha).toBeCloseTo(0.5, 5)
      animator.tick(0.5)
      await p
      expect(target.customAlpha).toBe(1)
    })

    it('rejects with AbortError when the node is destroyed mid-tween', async () => {
      const { scene, animator } = makeSceneWithAnimator()
      const node = new SceneNode('n')
      scene.root.add(node)
      const target = { v: 0 }
      const p = node.tweenTo(target, { v: 100 }, { duration: 1 })
      animator.tick(0.3)
      node.destroy()
      await expect(p).rejects.toMatchObject({ name: 'AbortError' })
    })

    it('rejects when the node is not scene-attached', async () => {
      const node = new SceneNode('n')
      await expect(
        node.tweenTo({ v: 0 }, { v: 1 }, { duration: 1 }),
      ).rejects.toThrow(/not attached/i)
    })
  })

  describe('SceneNode.autoDestroy (C3)', () => {
    it('destroys the node when the promise resolves', async () => {
      const { scene, animator } = makeSceneWithAnimator()
      const node = new SceneNode('n')
      scene.root.add(node)
      const p = node.tween({ x: 100 }, { duration: 0 })
      const done = node.autoDestroy(p)
      animator.tick(1)
      await done
      expect(node.isDestroyed).toBe(true)
    })

    it('destroys silently on AbortError', async () => {
      const { scene, animator } = makeSceneWithAnimator()
      const node = new SceneNode('n')
      scene.root.add(node)
      const ctrl = new AbortController()
      const p = node.tween({ x: 100 }, { duration: 1, signal: ctrl.signal })
      const warnings: string[] = []
      const origWarn = console.warn
      console.warn = (...args: unknown[]): void => {
        warnings.push(args.join(' '))
      }
      let done: Promise<void>
      try {
        done = node.autoDestroy(p)
        ctrl.abort()
        animator.tick(0.1)
        await done
      } finally {
        console.warn = origWarn
      }
      expect(node.isDestroyed).toBe(true)
      // No warn on abort, it's the documented cleanup path.
      expect(warnings.some((w) => /autoDestroy/i.test(w))).toBe(false)
    })

    it('destroys AND warns on non-abort rejection', async () => {
      const node = new SceneNode('n')
      const warnings: string[] = []
      const origWarn = console.warn
      console.warn = (...args: unknown[]): void => {
        warnings.push(args.join(' '))
      }
      try {
        await node.autoDestroy(Promise.reject(new Error('typo')))
      } finally {
        console.warn = origWarn
      }
      expect(node.isDestroyed).toBe(true)
      expect(warnings.some((w) => /autoDestroy/i.test(w))).toBe(true)
    })
  })

  describe('SceneNode.tweenStatic (C3)', () => {
    it('promotes a static-layer node to above-static for the tween and restores it', async () => {
      const { scene, animator } = makeSceneWithAnimator()
      const node = new SceneNode('n')
      node.renderLayer = 'static'
      scene.root.add(node)
      const p = node.tweenStatic({ alpha: 0.5 }, { duration: 1 })
      // Immediately after starting the tween, the node is on above-static.
      expect(node.renderLayer).toBe('above-static')
      animator.tick(1)
      await p
      // Settled, restored to static.
      expect(node.renderLayer).toBe('static')
      expect(node.transform.alpha).toBe(0.5)
    })

    it('no-ops on non-static nodes (acts as a plain tween)', async () => {
      const { scene, animator } = makeSceneWithAnimator()
      const node = new SceneNode('n')
      // dynamic by default
      scene.root.add(node)
      const p = node.tweenStatic({ alpha: 0.3 }, { duration: 1 })
      expect(node.renderLayer).toBe('dynamic')
      animator.tick(1)
      await p
      expect(node.renderLayer).toBe('dynamic')
      expect(node.transform.alpha).toBeCloseTo(0.3, 5)
    })
  })

  describe('SceneNode.loop (C1)', () => {
    it('runs iterations until the node is destroyed', async () => {
      const { scene, animator } = makeSceneWithAnimator()
      const node = new SceneNode('n')
      scene.root.add(node)
      const seen: number[] = []
      node.loop(
        async (ctx) => {
          seen.push(ctx.iteration)
          await ctx.nextFrame()
        },
        { deferAttach: false },
      )
      // Give the first iteration a chance to start.
      await Promise.resolve()
      // nextFrame is scheduled via animator.wait(0). Ticking the animator
      // resolves the wait, the loop advances to the next iteration.
      animator.tick(0)
      await Promise.resolve()
      animator.tick(0)
      await Promise.resolve()
      animator.tick(0)
      await Promise.resolve()
      expect(seen.length).toBeGreaterThanOrEqual(2)
      node.destroy()
      const countAtDestroy = seen.length
      // Further ticks should not advance the loop.
      animator.tick(0)
      await Promise.resolve()
      animator.tick(0)
      await Promise.resolve()
      expect(seen.length).toBe(countAtDestroy)
    })

    it('swallows AbortError silently when node is destroyed mid-await', async () => {
      const { scene, animator } = makeSceneWithAnimator()
      const node = new SceneNode('n')
      scene.root.add(node)
      const errors: string[] = []
      const origErr = console.error
      console.error = (...args: unknown[]): void => {
        errors.push(args.join(' '))
      }
      try {
        node.loop(
          async (ctx) => {
            await ctx.nextFrame()
          },
          { deferAttach: false, name: 'test-loop' },
        )
        await Promise.resolve()
        // Destroy mid-await; the nextFrame() wait rejects with AbortError.
        node.destroy()
        animator.tick(0)
        await Promise.resolve()
      } finally {
        console.error = origErr
      }
      // No `test-loop` error should have surfaced, abort is silent.
      expect(errors.some((e) => /test-loop/.test(e))).toBe(false)
    })

    it('logs non-abort errors from body but never crashes the engine', async () => {
      const { scene } = makeSceneWithAnimator()
      const node = new SceneNode('n')
      scene.root.add(node)
      const errors: string[] = []
      const origErr = console.error
      console.error = (...args: unknown[]): void => {
        errors.push(args.join(' '))
      }
      try {
        node.loop(() => Promise.reject(new Error('boom')), {
          deferAttach: false,
          name: 'boom-loop',
        })
        await Promise.resolve()
        await Promise.resolve()
      } finally {
        console.error = origErr
      }
      expect(errors.some((e) => /boom-loop/.test(e))).toBe(true)
    })
  })

  describe('bindPointer + PointerEvent2D types line up', () => {
    it('accepts PointerEvent2D-typed handlers', () => {
      const node = new SceneNode('n')
      const seen: number[] = []
      const unbind = node.bindPointer({
        down: (e: PointerEvent2D) => {
          seen.push(e.pointer.id)
        },
      })
      // Ideally we'd fire a real InputSystem event here, but that requires
      // a full Stage + canvas. The compile-time type check is the main
      // guarantee, this test just proves the assignment succeeds.
      expect(node.onPointerDown).toBeDefined()
      unbind()
    })
  })
})
