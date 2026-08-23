import { describe, expect, it } from 'vitest'
import { Animator, Node2D, SceneTree, type Engine } from '@src/stargazer'
import { FloatingScoreNode } from './FloatingScoreNode'
import { TileLayerNode } from './TileLayerNode'
import { computeBoardGeom, computeSoloSlot } from '../layout'
import { ANIM } from '../tuning'
import type { Tile } from '../types'

/** A scene whose nodes have a working `engine.animation`, as the engine gives. */
function makeScene(): { root: Node2D; animator: Animator } {
  const root = new Node2D('scene-root')
  const scene = new SceneTree(root)
  const animator = new Animator()
  scene.engine = { animation: animator } as unknown as Engine
  return { root, animator }
}

const GEOM = computeBoardGeom(
  computeSoloSlot({
    x: 0,
    y: 0,
    width: 1920,
    height: 1080,
  }),
)

describe('FloatingScoreNode', () => {
  it('rises, fades and removes itself', () => {
    const node = new FloatingScoreNode(48, 100, 200, 40)
    expect(node.transform.y).toBe(200)
    expect(node.transform.alpha).toBe(1)

    node.onUpdate(ANIM.floatScore / 2)
    expect(node.transform.y).toBeLessThan(200)
    expect(node.transform.alpha).toBeLessThan(1)
    expect(node.isDestroyed).toBe(false)

    node.onUpdate(ANIM.floatScore / 2)
    expect(node.transform.alpha).toBeCloseTo(0, 5)
    expect(node.isDestroyed).toBe(true)
  })

  it('animates without ever being attached to a scene', () => {
    // The bug this guards: driving the rise from `Node.tween`/`Node.wait` in the
    // constructor. Both reject on a node with no scene, so the "+N" never moved
    // and, because the destroy hung off the far side of the wait, never left.
    const node = new FloatingScoreNode(16, 0, 0, 20)
    for (let i = 0; i < 20; i++) node.onUpdate(ANIM.floatScore / 10)
    expect(node.isDestroyed).toBe(true)
  })

  it('does not outlive its duration even under a long frame', () => {
    const node = new FloatingScoreNode(4, 0, 0, 20)
    node.onUpdate(ANIM.floatScore * 10)
    expect(node.isDestroyed).toBe(true)
    expect(node.transform.alpha).toBe(0)
  })
})

describe('TileLayerNode.spawn', () => {
  const tile = (id: number, value: number, index: number): Tile => ({
    id,
    value,
    index,
  })

  it('grows a spawned tile in rather than leaving it at zero scale', () => {
    // `appear()` sets scale to 0 and tweens up. Called before the node joined a
    // scene, that tween rejected and the tile stayed invisible forever.
    const { root, animator } = makeScene()
    const layer = new TileLayerNode(GEOM)
    root.add(layer)

    layer.spawn(tile(1, 2, 0))
    animator.tick(ANIM.spawn * 0.5)

    const node = layer.children[0] as Node2D
    expect(node.transform.scaleX).toBeGreaterThan(0)
  })

  it('reaches full scale by the end of the spawn animation', () => {
    const { root, animator } = makeScene()
    const layer = new TileLayerNode(GEOM)
    root.add(layer)

    layer.spawn(tile(1, 4, 5))
    animator.tick(ANIM.spawn)

    const node = layer.children[0] as Node2D
    expect(node.transform.scaleX).toBeCloseTo(1, 5)
    expect(node.transform.scaleY).toBeCloseTo(1, 5)
  })
})
