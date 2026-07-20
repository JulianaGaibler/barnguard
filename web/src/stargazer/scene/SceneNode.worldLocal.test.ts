import { describe, expect, it } from 'vitest'
import { SceneNode } from './SceneNode'

describe('SceneNode world/local coordinate mapping', () => {
  it('round-trips through a translated + scaled node', () => {
    const node = new SceneNode()
    node.transform.x = 96
    node.transform.y = 54
    node.transform.scaleX = 0.9
    node.transform.scaleY = 0.9

    // local (0,0) sits at the node's world translation.
    expect(node.localToWorld(0, 0)).toEqual({ x: 96, y: 54 })

    // world → local inverts the scale + translate.
    const local = node.worldToLocal(96 + 0.9 * 100, 54 + 0.9 * 200)
    expect(local.x).toBeCloseTo(100, 6)
    expect(local.y).toBeCloseTo(200, 6)

    // full round-trip.
    const w = node.localToWorld(300, 400)
    const back = node.worldToLocal(w.x, w.y)
    expect(back.x).toBeCloseTo(300, 6)
    expect(back.y).toBeCloseTo(400, 6)
  })

  it('composes a parent transform into the child mapping', () => {
    const parent = new SceneNode()
    parent.transform.x = 1080 // launcher region offset
    const child = new SceneNode()
    child.transform.x = 96
    child.transform.scaleX = 0.5
    child.transform.scaleY = 0.5
    parent.add(child)

    // child local 0 → child world 96 → +parent 1080 = 1176.
    expect(child.localToWorld(0, 0).x).toBeCloseTo(1176, 6)
    expect(child.worldToLocal(1176, 0).x).toBeCloseTo(0, 6)
  })
})
