import { describe, expect, it } from 'vitest'
import { SceneTree } from '../scene/SceneTree'
import { Node2D } from '../scene/Node2D'
import { StageLayerRenderer } from '../render/StageLayerRenderer'
import type { CameraView2D, Affine2x3 } from '../camera/CameraView2D'
import type { Gfx2D, GfxClipShape } from '../render/gfx/Gfx2D'
import type { Renderer } from '../render/Renderer'
import { InsetViewNode, hasInsets } from './InsetViewNode'

/** An outer camera at one screen pixel per world unit, no pan. */
function identityCamera(): CameraView2D {
  const affine: Affine2x3 = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }
  return {
    screenToWorld: (x, y, out) =>
      Object.assign(out ?? { x: 0, y: 0 }, { x, y }),
    worldToScreen: (x, y, out) =>
      Object.assign(out ?? { x: 0, y: 0 }, { x, y }),
    visibleWorldRect: () => ({ x: 0, y: 0, width: 1000, height: 1000 }),
    screenPxPerWorldUnit: () => 1,
    strokeSpaceScale: () => 1,
    getScreenAffine: () => affine,
    viewport: { x: 0, y: 0, width: 1000, height: 1000 },
    frameNum: 0,
  }
}

/** Records the clip calls and the camera each node draws with. */
function recordingGfx(): { gfx: Gfx2D; clips: (GfxClipShape | null)[] } {
  const clips: (GfxClipShape | null)[] = []
  const gfx = {
    setBaseTransform: () => {},
    setAlpha: () => {},
    setClip: (shape: GfxClipShape | null) => clips.push(shape),
  } as unknown as Gfx2D
  return { gfx, clips }
}

/** A node that remembers the stroke scale and visible rect it was drawn with. */
class Probe extends Node2D {
  strokeScale = NaN
  seenRect: { width: number } | null = null
  override draw(_gfx: Gfx2D, camera: CameraView2D): void {
    this.strokeScale = camera.strokeSpaceScale()
    this.seenRect = camera.visibleWorldRect()
  }
}

const renderer = { cssSize: { w: 1000, h: 1000 } } as unknown as Renderer
const render: Affine2x3 = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }

let recordingGfxRef = recordingGfx()

function draw(scene: SceneTree): void {
  scene.updateTransforms()
  new StageLayerRenderer().drawLayer(
    scene,
    renderer,
    'dynamic',
    recordingGfxRef.gfx,
    identityCamera(),
    render,
    0,
  )
}
describe('InsetViewNode', () => {
  it('fits its viewport into its size, centred, preserving aspect', () => {
    const inset = new InsetViewNode({ width: 400, height: 520 })
    inset.viewport = { x: -39, y: -52, width: 78, height: 104 }
    const t = inset.content.transform
    expect(t.scaleX).toBeCloseTo(5, 6)
    expect(t.scaleY).toBeCloseTo(5, 6)
    // The viewport's centre lands on the inset's centre.
    expect(t.x).toBeCloseTo(200, 6)
    expect(t.y).toBeCloseTo(260, 6)
  })

  it('counts itself on the scene it joins and leaves', () => {
    const scene = new SceneTree()
    expect(hasInsets(scene)).toBe(false)
    const inset = new InsetViewNode({ width: 10, height: 10 })
    scene.root.add(inset)
    expect(hasInsets(scene)).toBe(true)
    scene.root.remove(inset)
    expect(hasInsets(scene)).toBe(false)
  })
})

describe('StageLayerRenderer with an inset', () => {
  it('clips a node inside the inset and clears the clip after it', () => {
    recordingGfxRef = recordingGfx()
    const scene = new SceneTree()
    const inset = new InsetViewNode({ width: 392, height: 516, radius: 40 })
    const probe = new Probe()
    inset.content.add(probe)
    scene.root.add(inset)
    draw(scene)
    expect(recordingGfxRef.clips).toEqual([
      { kind: 'roundRect', x: 0, y: 0, w: 392, h: 516, radius: 40 },
      null,
    ])
  })

  it('divides the stroke scale by the inset zoom', () => {
    recordingGfxRef = recordingGfx()
    const scene = new SceneTree()
    const inset = new InsetViewNode({ width: 400, height: 520 })
    inset.viewport = { x: 0, y: 0, width: 80, height: 104 }
    const probe = new Probe()
    inset.content.add(probe)
    scene.root.add(inset)
    draw(scene)
    expect(probe.strokeScale).toBeCloseTo(1 / 5, 6)
    expect(probe.seenRect?.width).toBe(80)
  })

  it('follows a scale on the inset itself', () => {
    recordingGfxRef = recordingGfx()
    const scene = new SceneTree()
    const holder = new Node2D()
    holder.transform.scaleX = 2
    holder.transform.scaleY = 2
    const inset = new InsetViewNode({ width: 100, height: 100 })
    const probe = new Probe()
    inset.content.add(probe)
    holder.add(inset)
    scene.root.add(holder)
    draw(scene)
    expect(probe.strokeScale).toBeCloseTo(1 / 2, 6)
  })

  it('leaves nodes outside any inset alone', () => {
    recordingGfxRef = recordingGfx()
    const scene = new SceneTree()
    const outside = new Probe()
    scene.root.add(outside)
    scene.root.add(new InsetViewNode({ width: 10, height: 10 }))
    draw(scene)
    expect(recordingGfxRef.clips).toEqual([])
    expect(outside.strokeScale).toBe(1)
  })
})
