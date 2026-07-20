import { createEngineHost } from '../engine/EngineHost'
import { SceneNode } from '../scene/SceneNode'
import { ShapeNode } from '../nodes/ShapeNode'
import { PolylineNode } from '../nodes/PolylineNode'
import { Behavior } from '../scene/Behavior'
import type { DemoFn } from './types'

// A tiny spinning-behavior for demo purposes.
class SpinBehavior extends Behavior {
  radPerSec: number
  constructor(radPerSec: number) {
    super()
    this.radPerSec = radPerSec
  }
  override onUpdate(dt: number): void {
    this.node.transform.rotation += this.radPerSec * dt
  }
}

class OrbitBehavior extends Behavior {
  #t = 0
  radPerSec: number
  radiusWorld: number
  centerX: number
  centerY: number
  constructor(radPerSec: number, radiusWorld: number, cx: number, cy: number) {
    super()
    this.radPerSec = radPerSec
    this.radiusWorld = radiusWorld
    this.centerX = cx
    this.centerY = cy
  }
  override onUpdate(dt: number): void {
    this.#t += dt * this.radPerSec
    this.node.transform.x = this.centerX + Math.cos(this.#t) * this.radiusWorld
    this.node.transform.y = this.centerY + Math.sin(this.#t) * this.radiusWorld
  }
}

class SpiralPolylineBehavior extends Behavior {
  #t = 0
  #line: PolylineNode
  readonly #maxT = Math.PI * 8
  readonly #cx: number
  readonly #cy: number
  constructor(line: PolylineNode, cx: number, cy: number) {
    super()
    this.#line = line
    this.#cx = cx
    this.#cy = cy
  }
  override onUpdate(dt: number): void {
    if (this.#t > this.#maxT) return
    // 30 sample steps per second, jaggy on purpose so smoothing shows.
    const stepsPerSec = 30
    const stepDt = 1 / stepsPerSec
    let acc = dt
    while (acc > 0 && this.#t <= this.#maxT) {
      const r = 5 + this.#t * 12
      const x = this.#cx + Math.cos(this.#t) * r
      const y = this.#cy + Math.sin(this.#t) * r
      this.#line.push(x, y)
      this.#t += stepDt
      acc -= stepDt
    }
  }
}

/**
 * M2 demo, a rotating group with nested orbiting children and a live
 * `PolylineNode` growing a spiral in quadratic-smoothing mode. Press `[T]` to
 * destroy the whole subtree; expect no exceptions and a clean canvas.
 */
const runDemo: DemoFn = async ({ canvas, signal, attach }) => {
  const host = createEngineHost({
    canvas,
    clearColor: '#0d1a2c',
    // Landscape 16:9, matches the target kiosk aspect and any dev browser.
    initialViewport: { x: 0, y: 0, width: 1920, height: 1080 },
  })
  attach?.(host)

  await host.loadScene((scene) => {
    // Central spinning group with children at fixed offsets.
    const group = new SceneNode('group')
    group.transform.x = 700
    group.transform.y = 640
    group.addBehavior(new SpinBehavior(0.6))

    // Two static children rotated with the group.
    const box = new ShapeNode({
      geometry: { kind: 'rect', width: 100, height: 60 },
      fill: '#ffd34d',
      stroke: '#fdf6e3',
      lineWidth: 3,
    })
    box.transform.x = 90
    group.add(box)

    const nestedGroup = new SceneNode('nested')
    nestedGroup.addBehavior(new SpinBehavior(2.0))
    const nestedShape = new ShapeNode({
      geometry: { kind: 'circle', radius: 18 },
      fill: '#a066ff',
    })
    nestedShape.transform.x = 40
    nestedGroup.add(nestedShape)
    nestedGroup.transform.x = -100
    group.add(nestedGroup)

    scene.root.add(group)

    // An orbiting ball above the group.
    const orbiter = new ShapeNode({
      id: 'orbiter',
      geometry: { kind: 'circle', radius: 14 },
      fill: '#41a8ff',
    })
    orbiter.addBehavior(new OrbitBehavior(1.2, 260, 700, 300))
    scene.root.add(orbiter)

    // Spiral polyline (jaggy input, quadratic-smoothed render).
    const spiral = new PolylineNode({
      capacity: 512,
      strokeStyle: '#fdf6e3',
      lineWidth: 2,
      smoothing: 'quadratic',
    })
    spiral.addBehavior(new SpiralPolylineBehavior(spiral, 1350, 540))
    scene.root.add(spiral)
  })

  host.start()

  // Wire `T` → destroy the whole scene subtree.
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 't' || e.key === 'T') {
      // Destroy all children of scene.root.
      const children = host.engine.scene.root.children.slice()
      for (const c of children) c.destroy()
      console.info('[demo-scene] destroyed scene tree, canvas should clear')
    }
  }
  window.addEventListener('keydown', onKey)

  const stop = (): void => {
    window.removeEventListener('keydown', onKey)
    host.destroy()
  }
  signal.addEventListener('abort', stop, { once: true })
  return stop
}

export default runDemo
