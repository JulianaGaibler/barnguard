/**
 * The cards on a real stage, drawing real frames.
 *
 * `demo.test.ts` checks the geometry a card lays out. This checks the thing
 * that geometry is for: that the scene reaches the renderer, every frame, for
 * as long as the card is on screen. A card can be laid out perfectly and still
 * show nothing, because a scene stops drawing for reasons that live outside
 * itself: a stage that faulted on a throw and halted, a node culled against the
 * viewport, an animation that tore down its own subtree partway through a loop.
 * All of those look identical from the outside, and none of them are visible to
 * a test that only reads numbers.
 *
 * So the harness is the real one: a secondary `Stage` on a mock device, sized
 * and parked the way `DemoStage` sizes and parks it, driven a second at a time
 * through the shared animator.
 *
 * @remarks
 *   The card building into a stage that has already rendered, which is what the
 *   modal actually does and what left the first card blank, is covered by
 *   `scene/treeIndex.test.ts`. That failure was in the tree's per-layer index
 *   rather than in any card, so it belongs next to the index.
 */
import { describe, expect, it } from 'vitest'
import { CameraNode2D } from '@src/stargazer/camera/CameraNode2D'
import { Engine } from '@src/stargazer/engine/Engine'
import { MockGfxDevice } from '@src/stargazer/render/gfx/webgl2/mockGfxDevice'
import type { EngineHost, Stage } from '@src/stargazer'
import type { DemoBuilder } from '@src/displays/arcade/tutorial/types'
import {
  buildFlushDemo,
  buildModesDemo,
  buildMoveDemo,
  buildOverflowDemo,
} from './demo'

const CARDS: [string, DemoBuilder][] = [
  ['move', buildMoveDemo],
  ['flush', buildFlushDemo],
  ['overflow', buildOverflowDemo],
  ['modes', buildModesDemo],
]

/** The fixed world rect the demo stage frames, from `DemoStage`. */
const DEMO_VIEWPORT = { x: 0, y: 0, width: 1000, height: 750 }

interface Harness {
  engine: Engine
  stage: Stage
  device: MockGfxDevice
  host: EngineHost
}

/** A secondary stage set up the way `DemoStage` sets one up at boot. */
function parkedStage(): Harness {
  const engine = new Engine({
    canvas: document.createElement('canvas'),
    gpuDevice: new MockGfxDevice(),
  })
  const device = new MockGfxDevice()
  const stage = engine.attachStage(document.createElement('canvas'), {
    name: 'Tutorial Demo',
    interactive: false,
    transparent: true,
    gpuDevice: device,
  })
  stage.renderer.resize(320, 240, 1)
  const cam = new CameraNode2D('demo-camera')
  cam.setViewport({ ...DEMO_VIEWPORT })
  cam.intrinsic = true
  stage.tree.root.add(cam)
  cam.makeCurrent()
  stage.setActive(false)
  return { engine, stage, device, host: { engine } as unknown as EngineHost }
}

/** Let the pipelines warm and any resolved `wait` run its continuation. */
const settle = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 0))

describe.each(CARDS)('the %s card', (name, build) => {
  it('draws on every frame of its first second', async () => {
    const { engine, stage, device, host } = parkedStage()
    // Revealed: a 4:3 slot on a retina screen, which is what the booth has.
    stage.setActive(true)
    stage.renderer.resize(480, 360, 2)
    // Warm, the way a stage built at boot behind the loading screen is by the
    // time anyone opens a tutorial.
    await settle()
    // The empty frame between revealing the stage and committing a card. It
    // leaves the per-layer index built and clean, so a card that fails to
    // dirty it on attach draws nothing at all. Building straight into a fresh
    // stage hides that.
    stage.updateTransforms()
    stage.render(1 / 60)

    build(stage, host)
    await settle()

    const blank: number[] = []
    for (let frame = 0; frame < 60; frame++) {
      device.reset()
      engine.animation.tick(1 / 60)
      stage.updateTransforms()
      stage.render(1 / 60)
      if (device.draws.length === 0) blank.push(frame)
      await settle()
    }

    // Reported together, so a failure says which card and whether the stage
    // died rather than just "expected 0 to be greater than 0".
    expect({ card: name, faulted: stage.faulted, blank }).toEqual({
      card: name,
      faulted: false,
      blank: [],
    })
    engine.destroy()
  })
})
