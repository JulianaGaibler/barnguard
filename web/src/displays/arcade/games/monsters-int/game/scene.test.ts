import { describe, expect, it, vi } from 'vitest'
import {
  CameraNode3D,
  MeshNode,
  Node2D,
  type EngineHost,
  type Node,
  type Rect,
} from '@src/stargazer'
import { REGION_HEIGHT, REGION_WIDTH } from '../../../world'
import { buildScene } from './scene'

// The 3D pass only runs when the scene tree reports 3D content AND a 3D camera
// is current. Both are easy to get wrong in a way that renders nothing at all
// and reports no error, so they are asserted here rather than in a browser.

const fakeTexture = {
  image: { bytes: null, mimeType: 'image/png', bitmap: null },
  sampler: { wrap: 'clamp', mipmap: false },
  srgb: true,
}

// Rasterising SVG needs a real browser, and none of these cases are about the
// artwork. Every loader hands back the same stand-in.
vi.mock('./art/tableTextures', () => ({
  loadMouthTexture: async () => fakeTexture,
  loadWordArt: async () => ({ texture: fakeTexture, aspect: 3 }),
}))
vi.mock('./art/cardTextures', () => ({
  CARD_BACK: 'card-back',
  loadCardTextures: async () => ({}),
}))

const VIEW: Rect = { x: 0, y: 0, width: REGION_WIDTH, height: REGION_HEIGHT }

/** A tree standing in for the engine's, which is all `buildScene` touches. */
function fakeHost(): { host: EngineHost; root: Node } {
  const root = new Node2D('root')
  const host = {
    engine: {
      tree: { root },
      // The scene hazes the far side of the table and hands the fog back when
      // it goes, so the fake has to carry one.
      fog: {
        enabled: false,
        mode: 'linear',
        color: [0, 0, 0],
        start: 0,
        end: 1,
      },
    },
  } as unknown as EngineHost
  return { host, root }
}

function descendants(node: Node): Node[] {
  const out: Node[] = []
  const walk = (n: Node): void => {
    out.push(n)
    for (const c of n.children) walk(c)
  }
  walk(node)
  return out
}

describe('buildScene', () => {
  it('puts 3D content in the tree, which is what turns the 3D pass on', () => {
    const { host, root } = fakeHost()
    buildScene({
      host,
      camera: { viewport: VIEW },
      view: VIEW,
      onHit() {},
      onStay() {},
    })
    const meshes = descendants(root).filter((n) => n instanceof MeshNode)
    expect(meshes.length).toBeGreaterThan(0)
  })

  it('adds a 3D camera, without which the pass draws nothing', () => {
    const { host, root } = fakeHost()
    buildScene({
      host,
      camera: { viewport: VIEW },
      view: VIEW,
      onHit() {},
      onStay() {},
    })
    const cameras = descendants(root).filter((n) => n instanceof CameraNode3D)
    expect(cameras).toHaveLength(1)
  })

  it('tears its whole subtree out again', () => {
    const { host, root } = fakeHost()
    const scene = buildScene({
      host,
      camera: { viewport: VIEW },
      view: VIEW,
      onHit() {},
      onStay() {},
    })
    scene.setSeats(5)
    expect(descendants(root).length).toBeGreaterThan(1)
    scene.destroy()
    expect(descendants(root)).toHaveLength(1)
  })

  it('hazes the far table while it runs, and hands the fog back when it goes', () => {
    const { host } = fakeHost()
    const scene = buildScene({
      host,
      camera: { viewport: VIEW },
      view: VIEW,
      onHit() {},
      onStay() {},
    })
    expect(host.engine.fog.enabled).toBe(true)
    scene.destroy()
    // A game that left it on would haze the launcher and every game after it.
    expect(host.engine.fog.enabled).toBe(false)
  })
})
