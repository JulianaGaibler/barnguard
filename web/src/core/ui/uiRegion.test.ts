import { describe, expect, it } from 'vitest'
import {
  Layer,
  Node2D,
  SceneTree,
  createEmitter,
  type Engine,
  type Stage,
} from '@src/stargazer'
import {
  DESIGN_HEIGHT,
  DESIGN_WIDTH,
  visibleRect,
  worldPerCssPx,
} from './designRegion'
import { UiRegion } from './uiRegion.svelte'

/** A scene with a UI layer fitted to the design region, over a canvas size. */
function rig(css: { w: number; h: number }) {
  const events = createEmitter<{ resize: { cssW: number; cssH: number } }>()
  const stage = {
    renderer: { cssSize: css },
    currentCamera2D: null,
  } as unknown as Stage
  const engine = { events, stageForScene: () => stage } as unknown as Engine
  const scene = new SceneTree(new Node2D('scene-root'))
  scene.engine = engine
  const layer = new Layer({
    space: {
      frame: { x: 0, y: 0, width: DESIGN_WIDTH, height: DESIGN_HEIGHT },
    },
  })
  scene.root.add(layer)
  const resize = (w: number, h: number): void => {
    stage.renderer.cssSize = { w, h }
    events.emit('resize', { cssW: w, cssH: h })
  }
  return { engine, layer, resize }
}

describe('UiRegion', () => {
  it('is the design region at 16:9', () => {
    const { engine, layer } = rig({ w: 1280, h: 720 })
    const region = new UiRegion(engine, layer)
    expect(region.rect.x).toBeCloseTo(0, 6)
    expect(region.rect.y).toBeCloseTo(0, 6)
    expect(region.rect.width).toBeCloseTo(DESIGN_WIDTH, 6)
    expect(region.rect.height).toBeCloseTo(DESIGN_HEIGHT, 6)
    expect(region.anchor.parent).toBe(layer)
  })

  it('matches the design fit at other canvas shapes', () => {
    for (const [w, h] of [
      [2560, 1080],
      [1440, 1080],
      [900, 900],
    ]) {
      const { engine, layer } = rig({ w, h })
      const region = new UiRegion(engine, layer)
      const want = visibleRect(w, h)
      expect(region.rect.x).toBeCloseTo(want.x, 6)
      expect(region.rect.y).toBeCloseTo(want.y, 6)
      expect(region.rect.width).toBeCloseTo(want.width, 6)
      expect(region.rect.height).toBeCloseTo(want.height, 6)
      expect(region.cssPxInWorld).toBeCloseTo(worldPerCssPx(w, h), 6)
    }
  })

  it('puts the anchor at the top left of the visible rect', () => {
    const { engine, layer } = rig({ w: 2560, h: 1080 })
    const region = new UiRegion(engine, layer)
    expect(region.anchor.transform.x).toBeCloseTo(region.rect.x, 6)
    expect(region.anchor.transform.y).toBeCloseTo(region.rect.y, 6)
    expect(region.anchor.boundsOverride).toEqual({
      x: 0,
      y: 0,
      width: region.rect.width,
      height: region.rect.height,
    })
  })

  it('refits when the canvas resizes, and tells its listeners', () => {
    const { engine, layer, resize } = rig({ w: 1280, h: 720 })
    const region = new UiRegion(engine, layer)
    const seen: number[] = []
    region.onResize((rect) => seen.push(rect.width))
    resize(2560, 1080)
    const want = visibleRect(2560, 1080)
    expect(region.rect.width).toBeCloseTo(want.width, 6)
    expect(region.anchor.transform.x).toBeCloseTo(want.x, 6)
    expect(seen).toHaveLength(1)
    expect(seen[0]).toBeCloseTo(want.width, 6)
  })

  it('stops listening once it is destroyed', () => {
    const { engine, layer, resize } = rig({ w: 1280, h: 720 })
    const region = new UiRegion(engine, layer)
    const seen: number[] = []
    region.onResize((rect) => seen.push(rect.width))
    region.destroy()
    resize(2560, 1080)
    expect(seen).toHaveLength(0)
    expect(region.anchor.isDestroyed).toBe(true)
  })
})
