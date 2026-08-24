import { describe, expect, it } from 'vitest'
import { Node3D } from './Node3D'
import { SceneTree } from './SceneTree'
import { Animator } from '../anim/Animator'
import type { Engine } from '../engine/Engine'

// A keyed tween is supposed to replace itself. The animator matches BOTH the
// key and the object being interpolated, so handing it a fresh object per call
// makes the key inert and lets tweens stack. Each survivor drives the transform
// from the pose it captured when IT started, so once the newer one finishes and
// leaves, the older one is still running and drags the node back onto its own
// path. On a node re-placed as often as a playing card that reads as jumping.

function attached(): { node: Node3D; animation: Animator } {
  const animation = new Animator()
  const tree = new SceneTree(new Node3D('root'))
  tree.engine = { animation } as unknown as Engine
  const node = new Node3D('node')
  tree.add(node)
  return { node, animation }
}

describe('Node3D keyed tweens', () => {
  it('replaces a move in flight rather than racing it', () => {
    const { node, animation } = attached()

    node.play({ position: { x: 10, y: 0, z: 0 } }, { duration: 1, key: 'move' })
    animation.tick(0.2)
    expect(node.transform.position.x).toBeCloseTo(2, 5)

    // Redirected, and to somewhere it arrives at sooner than the first move
    // would have finished. That is the case where a survivor shows itself.
    node.play(
      { position: { x: 0, y: 0, z: 0 } },
      { duration: 0.3, key: 'move' },
    )
    animation.tick(0.3)
    expect(node.transform.position.x).toBeCloseTo(0, 5)

    animation.tick(0.5)
    expect(node.transform.position.x).toBeCloseTo(0, 5)
  })

  it('runs differently keyed tweens side by side', () => {
    const { node, animation } = attached()
    node.transform.alpha = 0

    node.play({ position: { x: 10, y: 0, z: 0 } }, { duration: 1, key: 'move' })
    node.play({ alpha: 1 }, { duration: 1, key: 'fade' })
    animation.tick(0.5)
    expect(node.transform.position.x).toBeCloseTo(5, 5)
    expect(node.transform.alpha).toBeCloseTo(0.5, 5)
  })

  it('keeps one node from replacing another sharing the key', () => {
    const { node, animation } = attached()
    const other = new Node3D('other')
    node.parent!.add(other)

    node.play({ position: { x: 10, y: 0, z: 0 } }, { duration: 1, key: 'move' })
    other.play(
      { position: { x: 20, y: 0, z: 0 } },
      { duration: 1, key: 'move' },
    )
    animation.tick(1)
    expect(node.transform.position.x).toBeCloseTo(10, 5)
    expect(other.transform.position.x).toBeCloseTo(20, 5)
  })

  it('rejects the tween it replaced, so an awaiting caller unwinds', async () => {
    const { node } = attached()
    const first = node.tween(
      { position: { x: 10, y: 0, z: 0 } },
      { duration: 1, key: 'move' },
    )
    node.play({ position: { x: 0, y: 0, z: 0 } }, { duration: 1, key: 'move' })
    await expect(first).rejects.toThrow()
  })
})
