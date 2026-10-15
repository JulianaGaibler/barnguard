import { describe, expect, it } from 'vitest'
import { Node2D } from './Node2D'
import { Behavior } from './Behavior'
import { SceneTree } from './SceneTree'
import { Animator } from '../anim/Animator'
import type { Engine } from '../engine/Engine'
import type { PointerEvent2D } from '../input/PointerState'

/** Build a Scene with a working Animator on `scene.engine.animation`. */
function makeSceneWithAnimator(): { scene: SceneTree; animator: Animator } {
  const scene = new SceneTree(new Node2D('scene-root'))
  const animator = new Animator()
  scene.engine = { animation: animator } as unknown as Engine
  return { scene, animator }
}

class BehaviorA extends Behavior {}
class BehaviorB extends Behavior {}
class BehaviorC extends BehaviorA {}

describe('Node2D', () => {
  it('destroy() aborts the abort signal', () => {
    const node = new Node2D()
    expect(node.abortSignal.aborted).toBe(false)
    node.destroy()
    expect(node.abortSignal.aborted).toBe(true)
    expect(node.isDestroyed).toBe(true)
  })

  it('destroy() cascades to descendants', () => {
    const root = new Node2D('root')
    const child = new Node2D('child')
    const grandchild = new Node2D('grandchild')
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
    const node = new Node2D()
    let fired = false
    node.events.on('destroy', () => {
      fired = true
    })
    node.destroy()
    expect(fired).toBe(true)
  })

  it('destroy() removes itself from parent', () => {
    const parent = new Node2D('p')
    const child = new Node2D('c')
    parent.add(child)
    expect(parent.children.length).toBe(1)
    child.destroy()
    expect(parent.children.length).toBe(0)
  })

  it('getBehavior<T> returns the first matching instance', () => {
    const node = new Node2D()
    const a = new BehaviorA()
    const b = new BehaviorB()
    node.addBehavior(a)
    node.addBehavior(b)
    expect(node.getBehavior(BehaviorA)).toBe(a)
    expect(node.getBehavior(BehaviorB)).toBe(b)
  })

  it('getBehavior<T> supports subclass polymorphism', () => {
    const node = new Node2D()
    const c = new BehaviorC()
    node.addBehavior(c)
    // BehaviorC extends BehaviorA, lookup by BehaviorA returns it.
    expect(node.getBehavior(BehaviorA)).toBe(c)
    expect(node.getBehavior(BehaviorC)).toBe(c)
  })

  it('getBehaviors<T> returns all matches in insertion order', () => {
    const node = new Node2D()
    const a1 = new BehaviorA()
    const a2 = new BehaviorA()
    const b = new BehaviorB()
    node.addBehavior(a1)
    node.addBehavior(b)
    node.addBehavior(a2)
    const found = node.getBehaviors(BehaviorA)
    expect(found).toEqual([a1, a2])
  })

  describe('Behavior.onSceneReady (C4)', () => {
    it('fires synchronously when the node is already scene-attached at addBehavior', () => {
      const scene = new SceneTree(new Node2D('scene-root'))
      const node = new Node2D('n')
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
      const node = new Node2D('n')
      const seen: string[] = []
      class B extends Behavior {
        override onSceneReady(): void {
          seen.push('ready')
        }
      }
      node.addBehavior(new B())
      // Not yet attached, onSceneReady has NOT fired.
      expect(seen).toEqual([])
      const scene = new SceneTree(new Node2D('scene-root'))
      scene.root.add(node)
      // Attaching to a scene fires it.
      expect(seen).toEqual(['ready'])
    })

    it('fires only ONCE per addBehavior (detach + reattach does not refire)', () => {
      const scene = new SceneTree(new Node2D('scene-root'))
      const other = new SceneTree(new Node2D('scene-root'))
      const node = new Node2D('n')
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
      const scene = new SceneTree(new Node2D('scene-root'))
      const node = new Node2D('n')
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

  describe('Node2D.destroyChildren (C6)', () => {
    it('destroys every current child in a snapshot-safe cascade', () => {
      const parent = new Node2D('p')
      const a = new Node2D('a')
      const b = new Node2D('b')
      const c = new Node2D('c')
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
      const node = new Node2D('n')
      node.destroyChildren()
      expect(node.isDestroyed).toBe(false)
    })
  })

  describe('Node2D.bindPointer (C5)', () => {
    it('assigns handlers and the unbind clears them', () => {
      const node = new Node2D('n')
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
      const node = new Node2D('n')
      expect(node.hitEnabled).toBe(false)
      const unbind = node.bindPointer({ down: () => {} })
      expect(node.hitEnabled).toBe(true)
      unbind()
      expect(node.hitEnabled).toBe(false)
    })

    it('respects hitEnabled: false override', () => {
      const node = new Node2D('n')
      const unbind = node.bindPointer({ down: () => {}, hitEnabled: false })
      expect(node.hitEnabled).toBe(false)
      unbind()
    })

    it('unbind is idempotent', () => {
      const node = new Node2D('n')
      const unbind = node.bindPointer({ down: () => {} })
      unbind()
      unbind()
      expect(node.onPointerDown).toBeUndefined()
    })
  })

  describe('Node2D.tweenTo (C2)', () => {
    it('tweens numeric fields on an arbitrary target', async () => {
      const { scene, animator } = makeSceneWithAnimator()
      const node = new Node2D('n')
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
      const node = new Node2D('n')
      scene.root.add(node)
      const target = { v: 0 }
      const p = node.tweenTo(target, { v: 100 }, { duration: 1 })
      animator.tick(0.3)
      node.destroy()
      await expect(p).rejects.toMatchObject({ name: 'AbortError' })
    })

    it('rejects when the node is not scene-attached', async () => {
      const node = new Node2D('n')
      await expect(
        node.tweenTo({ v: 0 }, { v: 1 }, { duration: 1 }),
      ).rejects.toThrow(/not attached/i)
    })
  })

  describe('Node2D.autoDestroy (C3)', () => {
    it('destroys the node when the promise resolves', async () => {
      const { scene, animator } = makeSceneWithAnimator()
      const node = new Node2D('n')
      scene.root.add(node)
      const p = node.tween({ x: 100 }, { duration: 0 })
      const done = node.autoDestroy(p)
      animator.tick(1)
      await done
      expect(node.isDestroyed).toBe(true)
    })

    it('destroys silently on AbortError', async () => {
      const { scene, animator } = makeSceneWithAnimator()
      const node = new Node2D('n')
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
      const node = new Node2D('n')
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

  describe('bindPointer + PointerEvent2D types line up', () => {
    it('accepts PointerEvent2D-typed handlers', () => {
      const node = new Node2D('n')
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

  describe('bindPointer singlePointer', () => {
    const evt = (id: number): PointerEvent2D =>
      ({ pointer: { id } }) as unknown as PointerEvent2D

    it('ignores a second pointer until the first releases', () => {
      const node = new Node2D('n')
      const downs: number[] = []
      const moves: number[] = []
      const ups: number[] = []
      node.bindPointer({
        singlePointer: true,
        down: (e) => downs.push(e.pointer.id),
        move: (e) => moves.push(e.pointer.id),
        up: (e) => ups.push(e.pointer.id),
      })

      node.onPointerDown?.(evt(1)) // first press -> tracked
      node.onPointerDown?.(evt(2)) // second finger -> ignored
      node.onPointerMove?.(evt(2)) // move from the ignored finger -> dropped
      node.onPointerMove?.(evt(1)) // move from the tracked finger -> delivered
      node.onPointerUp?.(evt(2)) // up from the ignored finger -> dropped
      node.onPointerUp?.(evt(1)) // up from the tracked finger -> frees the slot

      expect(downs).toEqual([1])
      expect(moves).toEqual([1])
      expect(ups).toEqual([1])
    })

    it('accepts a new pointer once the tracked one has released', () => {
      const node = new Node2D('n')
      const downs: number[] = []
      node.bindPointer({
        singlePointer: true,
        down: (e) => downs.push(e.pointer.id),
      })
      node.onPointerDown?.(evt(1))
      node.onPointerUp?.(evt(1))
      node.onPointerDown?.(evt(2)) // slot free -> tracked
      expect(downs).toEqual([1, 2])
    })

    it('frees the slot on cancel', () => {
      const node = new Node2D('n')
      const downs: number[] = []
      node.bindPointer({
        singlePointer: true,
        down: (e) => downs.push(e.pointer.id),
        cancel: () => {},
      })
      node.onPointerDown?.(evt(1))
      node.onPointerCancel?.(evt(1))
      node.onPointerDown?.(evt(3))
      expect(downs).toEqual([1, 3])
    })
  })

  describe('fluent API', () => {
    it('add is variadic and preserves order, returning this', () => {
      const parent = new Node2D('p')
      const a = new Node2D('a')
      const b = new Node2D('b')
      const c = new Node2D('c')
      const ret = parent.add(a, b, c)
      expect(ret).toBe(parent)
      expect(parent.children.map((n) => n.id)).toEqual(['a', 'b', 'c'])
    })

    it('add still accepts a single child', () => {
      const parent = new Node2D('p')
      const a = new Node2D('a')
      expect(parent.add(a)).toBe(parent)
      expect(parent.children).toEqual([a])
    })

    it('remove is variadic and returns this', () => {
      const parent = new Node2D('p')
      const a = new Node2D('a')
      const b = new Node2D('b')
      const c = new Node2D('c')
      parent.add(a, b, c)
      const ret = parent.remove(a, c)
      expect(ret).toBe(parent)
      expect(parent.children).toEqual([b])
      expect(a.parent).toBeNull()
      expect(c.parent).toBeNull()
    })

    it('setVisible / setHitEnabled mutate and chain', () => {
      const node = new Node2D('n')
      const ret = node.setVisible(false).setHitEnabled(true)
      expect(ret).toBe(node)
      expect(node.visible).toBe(false)
      expect(node.hitEnabled).toBe(true)
    })

    it('removeBehavior and destroyChildren return this', () => {
      const node = new Node2D('n')
      const behavior = new BehaviorA()
      node.addBehavior(behavior)
      expect(node.removeBehavior(behavior)).toBe(node)

      const child = new Node2D('c')
      node.add(child)
      expect(node.destroyChildren()).toBe(node)
      expect(child.isDestroyed).toBe(true)
      expect(node.children).toEqual([])
    })

    it('a11y() returns the node and is inert on a detached node', () => {
      const node = new Node2D('n')
      // No scene/engine yet: semantics are held, nothing throws.
      const ret = node.a11y({ role: 'button', label: 'Go' })
      expect(ret).toBe(node)
    })

    it('addAt places a child at a position, and a move within a parent keeps it attached', () => {
      const scene = new SceneTree(new Node2D('scene-root'))
      const parent = new Node2D('p')
      const a = new Node2D('a')
      const b = new Node2D('b')
      const c = new Node2D('c')
      scene.root.add(parent)
      parent.add(a, b)
      parent.addAt(c, 0)
      expect(parent.children).toEqual([c, a, b])
      parent.addAt(c, 3)
      expect(parent.children).toEqual([a, b, c])
      parent.addAt(c, 1)
      expect(parent.children).toEqual([a, c, b])
      expect(scene.getPainterOrder().map((n) => n.id)).toEqual([
        'scene-root',
        'p',
        'a',
        'c',
        'b',
      ])
      expect(c.parent).toBe(parent)
    })

    it('insertBefore adds ahead of a reference child and rejects a stranger', () => {
      const parent = new Node2D('p')
      const a = new Node2D('a')
      const b = new Node2D('b')
      parent.add(a)
      parent.insertBefore(b, a)
      expect(parent.children).toEqual([b, a])
      expect(() =>
        parent.insertBefore(new Node2D('x'), new Node2D('y')),
      ).toThrow()
    })
  })
})
