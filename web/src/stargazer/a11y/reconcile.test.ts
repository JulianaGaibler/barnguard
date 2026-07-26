import { describe, expect, it } from 'vitest'
import { SceneTree } from '../scene/SceneTree'
import { Node2D } from '../scene/Node2D'
import {
  reconcileChildren,
  reconcileTree,
  type ReconcileEntry,
} from './reconcile'
import type { Semantics } from './types'

function entry(node: Node2D, semantics: Semantics): ReconcileEntry {
  return { node, element: document.createElement('div'), semantics }
}

/** Registered entries in scene painter pre-order (as the subsystem passes them). */
function ordered(scene: SceneTree, entries: ReconcileEntry[]): ReconcileEntry[] {
  const byNode = new Map(entries.map((e) => [e.node, e]))
  const out: ReconcileEntry[] = []
  for (const n of scene.getPainterOrder()) {
    const e = byNode.get(n)
    if (e) out.push(e)
  }
  return out
}

describe('reconcileChildren', () => {
  it('reorders existing children without recreating them', () => {
    const parent = document.createElement('div')
    const x = document.createElement('span')
    const y = document.createElement('span')
    parent.append(y, x) // wrong order
    reconcileChildren(parent, [x, y], new Set([x, y]))
    expect([...parent.children]).toEqual([x, y])
    // Same references, never recreated.
    expect(parent.children[0]).toBe(x)
    expect(parent.children[1]).toBe(y)
  })

  it('removes genuinely orphaned children but keeps live ones for their owner', () => {
    const parent = document.createElement('div')
    const keep = document.createElement('span')
    const orphan = document.createElement('span')
    const elsewhere = document.createElement('span')
    parent.append(keep, orphan, elsewhere)
    // `elsewhere` is live (belongs to another parent); `orphan` is not.
    reconcileChildren(parent, [keep], new Set([keep, elsewhere]))
    expect([...parent.children]).toEqual([keep, elsewhere])
  })
})

describe('reconcileTree', () => {
  it('nests each node under its nearest registered ancestor, skipping the rest', () => {
    const scene = new SceneTree(new Node2D('scene-root'))
    const group = new Node2D('group')
    const mid = new Node2D('mid') // not registered
    const leaf = new Node2D('leaf')
    scene.root.add(group)
    group.add(mid)
    mid.add(leaf)

    const eg = entry(group, { role: 'group' })
    const el = entry(leaf, { role: 'button' })
    const content = document.createElement('div')
    reconcileTree(content, ordered(scene, [eg, el]))

    expect([...content.children]).toEqual([eg.element])
    expect([...eg.element.children]).toEqual([el.element]) // skipped `mid`
  })

  it('orders siblings by painter order, with `order` as a tiebreak', () => {
    const scene = new SceneTree(new Node2D('scene-root'))
    const a = new Node2D('a')
    const b = new Node2D('b')
    scene.root.add(a)
    scene.root.add(b)

    const ea = entry(a, { role: 'button' })
    const eb = entry(b, { role: 'button' })
    const content = document.createElement('div')

    reconcileTree(content, ordered(scene, [ea, eb]))
    expect([...content.children]).toEqual([ea.element, eb.element])

    // `order` flips them.
    ea.semantics = { role: 'button', order: 2 }
    eb.semantics = { role: 'button', order: 1 }
    reconcileTree(content, ordered(scene, [ea, eb]))
    expect([...content.children]).toEqual([eb.element, ea.element])
  })

  it('moves an element on reparent, preserving its identity', () => {
    const scene = new SceneTree(new Node2D('scene-root'))
    const g1 = new Node2D('g1')
    const g2 = new Node2D('g2')
    const leaf = new Node2D('leaf')
    scene.root.add(g1)
    scene.root.add(g2)
    g1.add(leaf)

    const e1 = entry(g1, { role: 'group' })
    const e2 = entry(g2, { role: 'group' })
    const el = entry(leaf, { role: 'button' })
    const content = document.createElement('div')

    reconcileTree(content, ordered(scene, [e1, e2, el]))
    expect([...e1.element.children]).toEqual([el.element])

    // Reparent leaf under g2.
    g2.add(leaf)
    reconcileTree(content, ordered(scene, [e1, e2, el]))
    expect([...e1.element.children]).toEqual([])
    expect([...e2.element.children]).toEqual([el.element])
  })
})
