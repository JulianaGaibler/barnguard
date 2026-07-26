import { describe, expect, it, vi } from 'vitest'
import { Node3D } from './Node3D'
import { SceneTree } from './SceneTree'
import { Behavior } from './Behavior'
import { mat4TransformPoint } from '../math/Mat4'
import { vec3 } from '../math/Vec3'

describe('Node3D world transform', () => {
  it('composes parent × child translation', () => {
    const world = new SceneTree(new Node3D('world3d-root'))
    const parent = new Node3D('parent')
    const child = new Node3D('child')
    parent.transform.setPosition(10, 0, 0)
    child.transform.setPosition(0, 5, 0)
    world.add(parent)
    parent.add(child)

    world.updateTransforms()

    const p = mat4TransformPoint(vec3(), child.worldMatrix, 0, 0, 0)
    expect(p.x).toBeCloseTo(10, 5)
    expect(p.y).toBeCloseTo(5, 5)
    expect(p.z).toBeCloseTo(0, 5)
  })

  it('re-parenting marks the subtree world-dirty', () => {
    const world = new SceneTree(new Node3D('world3d-root'))
    const a = new Node3D('a')
    const b = new Node3D('b')
    world.add(a, b)
    world.updateTransforms()
    expect(b.worldDirty).toBe(false)
    a.transform.setPosition(3, 0, 0)
    a.add(b)
    expect(b.worldDirty).toBe(true)
  })
})

describe('Node3D tree + owner', () => {
  it('add sets parent and attaches to the world owner', () => {
    const world = new SceneTree(new Node3D('world3d-root'))
    const node = new Node3D('n')
    world.add(node)
    expect(node.parent).toBe(world.root)
    expect(node.owner).toBe(world)
  })

  it('fires behavior onSceneReady on attach', () => {
    const world = new SceneTree(new Node3D('world3d-root'))
    const node = new Node3D('n')
    const ready = vi.fn()
    class Ready extends Behavior {
      override onSceneReady(): void {
        ready()
      }
    }
    node.addBehavior(new Ready())
    expect(ready).not.toHaveBeenCalled()
    world.add(node)
    expect(ready).toHaveBeenCalledTimes(1)
  })
})

describe('Node3D lifecycle', () => {
  it('destroy aborts the node signal and detaches from parent', () => {
    const world = new SceneTree(new Node3D('world3d-root'))
    const node = new Node3D('n')
    world.add(node)
    const signal = node.abortSignal
    expect(signal.aborted).toBe(false)
    node.destroy()
    expect(signal.aborted).toBe(true)
    expect(world.root.children).not.toContain(node)
    expect(node.isDestroyed).toBe(true)
  })

  it('tween rejects when not attached to an engine', async () => {
    const node = new Node3D('n')
    await expect(node.tween({ alpha: 0 }, { duration: 1 })).rejects.toThrow(
      /not attached to an Engine/,
    )
  })
})
