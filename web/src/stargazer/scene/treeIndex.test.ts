/**
 * The per-layer index keeps up with the tree, whatever kind of node the change
 * hangs off.
 *
 * Painter order is a property of the whole tree, but the invalidation used to
 * be raised by `Node2D`'s child hooks, so it depended on the PARENT being a
 * `Node2D`. A `SceneTree`'s default root is a transform-less `GroupNode`, which
 * is what every `Stage` ships with, so adding a top-level node raised nothing
 * and the index kept whatever it last built.
 *
 * That is invisible until something reads the index before the change: the read
 * marks it clean, the change does not dirty it, and the node then sits
 * correctly in the tree while drawing nothing and hit-testing as absent. Which
 * is why every case here reads FIRST. Without that line the assertions pass
 * against the bug.
 */
import { describe, expect, it } from 'vitest'
import { Node2D } from './Node2D'
import { SceneTree } from './SceneTree'
import { GroupNode } from './GroupNode'
import type { Node } from './Node'

/** A dynamic-layer node, the layer most game content draws on. */
function content(id: string): Node2D {
  const n = new Node2D(id)
  n.renderLayer = 'dynamic'
  return n
}

const ids = (nodes: readonly Node2D[]): string[] => nodes.map((n) => n.id)

/**
 * The content on `layer`, named. A `Node2D` root is itself content and shows up
 * in its own index, so it is dropped here to leave one expectation that reads
 * the same for both roots.
 */
const shown = (scene: SceneTree, root: Node, layer = 'dynamic' as const) =>
  ids(scene.getLayerNodes(layer)).filter((id) => id !== root.id)

/**
 * The two roots a tree can have. The group root is what `new SceneTree()` and
 * therefore every `Stage` uses, so it is the case that matters most and the one
 * that was uncovered.
 */
const ROOTS: [string, () => { scene: SceneTree; root: Node }][] = [
  [
    'a group root, the shipping default',
    () => {
      const scene = new SceneTree()
      return { scene, root: scene.root }
    },
  ],
  [
    'a Node2D root',
    () => {
      const root = new Node2D('scene-root')
      return { scene: new SceneTree(root), root }
    },
  ],
]

describe.each(ROOTS)('under %s', (_name, make) => {
  it('indexes a node added after the index was read', () => {
    const { scene, root } = make()
    expect(shown(scene, root)).toEqual([])

    root.add(content('late'))
    expect(shown(scene, root)).toEqual(['late'])
  })

  it('indexes a whole subtree attached after the index was read', () => {
    // How every tutorial card and most game scenes are built: assemble
    // detached, attach once.
    const { scene, root } = make()
    scene.getLayerNodes('dynamic')

    const branch = content('branch')
    branch.add(content('leaf-a'), content('leaf-b'))
    root.add(branch)
    expect(shown(scene, root)).toEqual(['branch', 'leaf-a', 'leaf-b'])
  })

  it('drops a removed node from the index', () => {
    const { scene, root } = make()
    const gone = content('gone')
    root.add(gone, content('stays'))
    scene.getLayerNodes('dynamic')

    root.remove(gone)
    expect(shown(scene, root)).toEqual(['stays'])
  })

  it('drops a destroyed subtree from the index', () => {
    const { scene, root } = make()
    const branch = content('branch')
    branch.add(content('leaf'))
    root.add(branch, content('stays'))
    scene.getLayerNodes('dynamic')

    branch.destroy()
    expect(shown(scene, root)).toEqual(['stays'])
  })

  it('follows a reparent', () => {
    const { scene, root } = make()
    const host = content('host')
    const moved = content('moved')
    root.add(host, moved)
    expect(shown(scene, root)).toEqual(['host', 'moved'])

    host.add(moved)
    expect(shown(scene, root)).toEqual(['host', 'moved'])
    expect(moved.parent).toBe(host)
  })

  it('keeps painter order in step, which is what hit-testing reads', () => {
    // A node missing here is unreachable by touch, which reads as a dead
    // button rather than as a missing node.
    const { scene, root } = make()
    scene.getPainterOrder()

    const button = content('button')
    root.add(button)
    expect(ids(scene.getPainterOrder())).toContain('button')
  })
})

describe('a group node in the middle of the tree', () => {
  it('reports a change to the tree above it', () => {
    // The root is not the only transform-less parent: `GroupNode` is offered
    // for grouping anywhere, so the rule cannot be about the root either.
    const scene = new SceneTree()
    const group = new GroupNode('group')
    scene.root.add(group)
    expect(scene.getLayerNodes('dynamic')).toEqual([])

    group.add(content('under-group'))
    expect(ids(scene.getLayerNodes('dynamic'))).toEqual(['under-group'])
    expect(scene.getLayerNodes('dynamic')).toHaveLength(1)
  })
})
