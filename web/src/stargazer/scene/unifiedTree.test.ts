import { describe, it, expect } from 'vitest'
import { SceneTree } from './SceneTree'
import { GroupNode } from './GroupNode'
import { Node2D } from './Node2D'
import { Node3D } from './Node3D'
import { walkTree } from './traverse'

// The unified tree holds 2D and 3D nodes together (Godot-style). These pin the
// invariants that keep the two dimensions coherent within one tree: DFS order,
// nearest-same-kind transform composition, kind-bucketed painter order, and
// cross-dimension dirty isolation.
describe('unified scene tree', () => {
  it('walkTree yields DFS pre-order across mixed kinds', () => {
    const root = new GroupNode('root')
    const a = new Node2D('a')
    const b = new Node3D('b')
    const c = new Node2D('c')
    root.add(a)
    a.add(b)
    b.add(c)
    const ids: string[] = []
    walkTree(root, (n) => ids.push(n.id))
    expect(ids).toEqual(['root', 'a', 'b', 'c'])
  })

  it('a Node2D composes world from its nearest Node2D ancestor, skipping other kinds', () => {
    const tree = new SceneTree()
    const a = new Node2D('a')
    const b = new Node3D('b')
    const c = new Node2D('c')
    a.transform.x = 100
    c.transform.x = 10
    tree.root.add(a)
    a.add(b)
    b.add(c)
    c.ensureWorldTransform()
    // C's world X is A.x + C.x = 110; the intervening 3D node contributes nothing.
    expect(c.transform.world.e).toBeCloseTo(110, 5)
  })

  it('a Node3D composes world from its nearest Node3D ancestor, ignoring a 2D parent', () => {
    const tree = new SceneTree()
    const a = new Node2D('a')
    const b = new Node3D('b')
    a.transform.x = 100
    b.transform.setPosition(5, 0, 0)
    tree.root.add(a)
    a.add(b)
    b.ensureWorldTransform()
    // B has no 3D ancestor, so its world equals its local (the 2D parent is ignored).
    expect(b.worldMatrix[12]).toBeCloseTo(5, 5)
  })

  it('getPainterOrder collects only Node2D nodes in DFS order', () => {
    const tree = new SceneTree()
    const a = new Node2D('a')
    const b = new Node3D('b')
    const c = new Node2D('c')
    const d = new Node2D('d')
    tree.root.add(a, b)
    a.add(c)
    b.add(d)
    // a, then a's 2D child c, then b (3D) is skipped, then b's 2D child d.
    expect(tree.getPainterOrder().map((n) => n.id)).toEqual(['a', 'c', 'd'])
  })

  it('has3D reflects whether any Node3D is present', () => {
    const tree = new SceneTree()
    const a = new Node2D('a')
    tree.root.add(a)
    expect(tree.has3D).toBe(false)
    const b = new Node3D('b')
    a.add(b)
    expect(tree.has3D).toBe(true)
  })

  it('a 2D transform change dirties nested 2D descendants but not intervening 3D', () => {
    const tree = new SceneTree()
    const a = new Node2D('a')
    const b = new Node3D('b')
    const c = new Node2D('c')
    tree.root.add(a)
    a.add(b)
    b.add(c)
    tree.updateTransforms()
    expect(a.worldDirty).toBe(false)
    expect(b.worldDirty).toBe(false)
    expect(c.worldDirty).toBe(false)

    a.transform.x = 50
    expect(a.worldDirty).toBe(true)
    expect(c.worldDirty).toBe(true) // its nearest 2D ancestor moved
    expect(b.worldDirty).toBe(false) // the 3D node's world is unchanged
  })

  it('a 3D transform change dirties nested 3D descendants but not intervening 2D', () => {
    const tree = new SceneTree()
    const a = new Node3D('a')
    const b = new Node2D('b')
    const c = new Node3D('c')
    tree.root.add(a)
    a.add(b)
    b.add(c)
    tree.updateTransforms()
    expect(a.worldDirty).toBe(false)
    expect(b.worldDirty).toBe(false)
    expect(c.worldDirty).toBe(false)

    a.transform.setPosition(1, 0, 0)
    expect(a.worldDirty).toBe(true)
    expect(c.worldDirty).toBe(true) // its nearest 3D ancestor moved
    expect(b.worldDirty).toBe(false) // the 2D node's world is unchanged
  })

  it('reparenting recomposes across kinds (full subtree dirty)', () => {
    const tree = new SceneTree()
    const g1 = new GroupNode('g1')
    const g2 = new GroupNode('g2')
    const a = new Node2D('a')
    a.transform.x = 7
    tree.root.add(g1, g2)
    g1.add(a)
    tree.updateTransforms()
    expect(a.worldDirty).toBe(false)

    g2.add(a) // reparent
    expect(a.worldDirty).toBe(true)
  })
})
