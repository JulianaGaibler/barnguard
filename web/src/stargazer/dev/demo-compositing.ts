import { createEngineHost } from '../engine/EngineHost'
import { addDemoCamera } from './demoCamera'
import { Node2D } from '../scene/Node2D'
import { ShapeNode } from '../nodes/ShapeNode'
import { GfxPath } from '../render/gfx/GfxPath'
import type { Gfx2D } from '../render/gfx/Gfx2D'
import type { DemoFn } from './types'

// Engine compositing sandbox: nonzero and even-odd fills, nested path clips
// under rotation, and a clipped scroll panel built with `Node2D.clip`. Run it
// on `?gfx=webgl2` and `?gfx=webgpu`, with `?msaa=1` and `?msaa=4`. Each
// column should look the same on both backends.

function star(cx: number, cy: number, r: number): GfxPath {
  const p = new GfxPath()
  for (let i = 0; i < 5; i++) {
    const a = (i * 4 * Math.PI) / 5 - Math.PI / 2
    const x = cx + r * Math.cos(a)
    const y = cy + r * Math.sin(a)
    if (i === 0) p.moveTo(x, y)
    else p.lineTo(x, y)
  }
  return p.close()
}

/**
 * A star filled under both rules, side by side, with a hole contour on the
 * right.
 */
class FillRules extends Node2D {
  readonly #a = star(100, 100, 90)
  readonly #b = star(300, 100, 90)
  override draw(gfx: Gfx2D): void {
    gfx.fillPath(this.#a, '#f5c542', 'nonzero')
    gfx.fillPath(this.#b, '#7cc4ff', 'evenodd')
    gfx.strokePath(this.#a, { color: '#ffffff', width: 2 })
    gfx.strokePath(this.#b, { color: '#ffffff', width: 2, dash: [10, 6] })
  }
}

/** Two nested clips on a rotating group of stripes. */
class NestedClips extends Node2D {
  #t = 0
  readonly #outer = star(0, 0, 110)
  readonly #inner = new GfxPath()
    .moveTo(-40, -120)
    .lineTo(120, -20)
    .lineTo(20, 120)
    .lineTo(-120, 40)
    .close()
  override onUpdate(dt: number): void {
    this.#t += dt
  }
  override draw(gfx: Gfx2D): void {
    gfx.save()
    gfx.translate(160, 160)
    gfx.rotate(this.#t * 0.5)
    gfx.clipPath(this.#outer)
    gfx.save()
    gfx.rotate(-this.#t)
    gfx.clipPath(this.#inner)
    for (let i = -8; i < 8; i++) {
      gfx.fillRect(i * 30, -200, 15, 400, i % 2 ? '#ff6b6b' : '#ffd93d')
    }
    gfx.restore()
    gfx.fillRect(-300, 90, 600, 12, '#2d2d44')
    gfx.restore()
  }
}

const runDemo: DemoFn = async ({ canvas, signal, attach }) => {
  const host = createEngineHost({ canvas, clearColor: '#14171f' })
  attach?.(host)
  await host.loadScene((scene) => {
    addDemoCamera(scene, { x: 0, y: 0, width: 1920, height: 1080 })
    const rules = new FillRules()
    rules.transform.x = 60
    rules.transform.y = 60
    scene.root.add(rules)

    const nested = new NestedClips()
    nested.transform.x = 560
    nested.transform.y = 40
    scene.root.add(nested)

    // A scroll panel: rows move up and are cut off at the panel's edge.
    const panel = new Node2D()
    panel.transform.x = 1000
    panel.transform.y = 60
    panel.clip = { x: 0, y: 0, width: 360, height: 280 }
    const back = new ShapeNode({
      geometry: { kind: 'rect', width: 360, height: 280, centered: false },
      fill: '#222638',
    })
    panel.add(back)
    const rows = new Node2D()
    for (let i = 0; i < 12; i++) {
      const row = new ShapeNode({
        geometry: {
          kind: 'rect',
          width: 340,
          height: 44,
          centered: false,
          radii: 10,
        },
        fill: i % 2 ? '#3a4a7a' : '#4b5f9e',
      })
      row.transform.x = 10
      row.transform.y = i * 52
      rows.add(row)
    }
    panel.add(rows)
    let t = 0
    rows.onUpdate = (dt: number) => {
      t += dt
      rows.transform.y = 10 - ((t * 40) % 300)
    }
    rows._recomputeHasWork()
    scene.root.add(panel)
  })
  host.start()
  const stop = (): void => host.destroy()
  signal.addEventListener('abort', stop, { once: true })
  return stop
}

export default runDemo
