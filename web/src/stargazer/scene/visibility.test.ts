import { describe, expect, it } from 'vitest'
import { Node2D } from './Node2D'
import { Node3D } from './Node3D'
import { isEffectivelyVisible } from './traverse'

// Hiding a group has to hide what is under it. The render and hit walks read
// flattened per-layer lists rather than descending the tree, so nothing about
// the walk enforces this on its own.

describe('isEffectivelyVisible', () => {
  it('is true for a visible node with no parent', () => {
    expect(isEffectivelyVisible(new Node2D('solo'))).toBe(true)
  })

  it('is false for a node hidden directly', () => {
    const node = new Node2D('node')
    node.visible = false
    expect(isEffectivelyVisible(node)).toBe(false)
  })

  it('is false for a visible child of a hidden parent', () => {
    const group = new Node2D('group')
    const child = new Node2D('child')
    group.add(child)
    group.visible = false
    expect(child.visible).toBe(true)
    expect(isEffectivelyVisible(child)).toBe(false)
  })

  it('reaches all the way up, not just one level', () => {
    const root = new Node2D('root')
    const mid = new Node2D('mid')
    const leaf = new Node2D('leaf')
    root.add(mid)
    mid.add(leaf)
    root.visible = false
    expect(isEffectivelyVisible(leaf)).toBe(false)
  })

  it('comes back when the parent is shown again', () => {
    const group = new Node2D('group')
    const child = new Node2D('child')
    group.add(child)
    group.visible = false
    group.visible = true
    expect(isEffectivelyVisible(child)).toBe(true)
  })

  it('applies to 3D nodes under a hidden group', () => {
    const group = new Node3D('group')
    const child = new Node3D('child')
    group.add(child)
    group.visible = false
    expect(isEffectivelyVisible(child)).toBe(false)
  })

  it('does not resurrect a hidden child under a visible parent', () => {
    const group = new Node2D('group')
    const child = new Node2D('child')
    group.add(child)
    child.visible = false
    expect(isEffectivelyVisible(child)).toBe(false)
  })
})
