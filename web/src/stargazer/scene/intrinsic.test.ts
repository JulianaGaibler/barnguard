import { describe, expect, it } from 'vitest'
import { SceneTree } from './SceneTree'
import { GroupNode } from './GroupNode'
import { Node2D } from './Node2D'
import { Node3D } from './Node3D'

describe('intrinsic nodes are skipped by content scans', () => {
  it('getPainterOrder excludes intrinsic 2D nodes', () => {
    const tree = new SceneTree(new GroupNode('root'))
    const content = new Node2D('content')
    const cam = new Node2D('intrinsic-cam')
    cam.intrinsic = true
    tree.root.add(cam, content)
    const order = tree.getPainterOrder()
    expect(order).toContain(content)
    expect(order).not.toContain(cam)
  })

  it('has3D ignores intrinsic 3D nodes but sees real content', () => {
    const tree = new SceneTree(new GroupNode('root'))
    const cam3d = new Node3D('intrinsic-cam3d')
    cam3d.intrinsic = true
    tree.root.add(cam3d)
    expect(tree.has3D).toBe(false)

    tree.root.add(new Node3D('mesh'))
    expect(tree.has3D).toBe(true)
  })

  it('destroyChildren preserves intrinsic children, destroys the rest', () => {
    const tree = new SceneTree(new GroupNode('root'))
    const content = new Node2D('content')
    const cam = new Node2D('intrinsic-cam')
    cam.intrinsic = true
    tree.root.add(cam, content)

    tree.root.destroyChildren()

    expect(cam.isDestroyed).toBe(false)
    expect(content.isDestroyed).toBe(true)
    expect(tree.root.children).toContain(cam)
    expect(tree.root.children).not.toContain(content)
  })
})
