import { createEngineHost } from '../engine/EngineHost'
import { ShapeNode } from '../nodes/ShapeNode'
import { PolylineNode } from '../nodes/PolylineNode'
import type { PointerEvent2D } from '../input/PointerState'
import type { DemoFn } from './types'

interface DraggableShape {
  shape: ShapeNode
  trail: PolylineNode
  color: string
  home: { x: number; y: number }
  activePointerId: number | null
}

/**
 * M5 demo, two draggable shapes with polyline trails.
 *
 * - Press-and-drag either shape: it follows the pointer, leaving a
 *   quadratic-smoothed trail.
 * - Two-finger simultaneous drag (touchscreen) or mouse+trackpad: both shapes
 *   move independently thanks to per-pointer node capture.
 * - Release outside the canvas / drag past the bezel: the drag KEEPS WORKING (DOM
 *   `setPointerCapture` routes events back to us).
 * - Press `D`: shape 1 is destroyed mid-drag, `onPointerCancel` fires, the trail
 *   freezes, and the input system releases the capture.
 * - Boot with `?demo=input&debug=hud`: the HUD's "Pointers" section shows each
 *   active pointer's screen/world coord + captured node id.
 * - Toggle the debug camera (`C`) mid-drag and pan (`WASD`): the shape under the
 *   finger keeps sticking to the cursor thanks to per-frame world-coord
 *   reprojection.
 */
const runDemo: DemoFn = async ({ canvas, signal, attach }) => {
  const host = createEngineHost({
    canvas,
    clearColor: '#0d1a2c',
    initialViewport: { x: 0, y: 0, width: 1920, height: 1080 },
  })
  attach?.(host)

  const draggables: DraggableShape[] = []

  await host.loadScene((scene) => {
    draggables.push(makeDraggable('shape:amber', 640, 540, '#ffd34d'))
    draggables.push(makeDraggable('shape:sky', 1280, 540, '#41a8ff'))
    for (const d of draggables) {
      scene.root.add(d.trail)
      scene.root.add(d.shape)
    }
  })

  host.start()

  const stopHandlers: Array<() => void> = []

  // Wire each shape's pointer callbacks. `shape` captures on down, moves
  // itself + trail on move, releases on up/cancel.
  for (const d of draggables) {
    d.shape.onPointerDown = (e: PointerEvent2D): void => {
      // Ignore a second finger on an already-captured shape, one pointer
      // owns each shape at a time.
      if (d.activePointerId !== null) return
      d.activePointerId = e.pointer.id
      d.trail.clear()
      d.trail.push(d.shape.transform.x, d.shape.transform.y)
      console.info(
        `[demo-input] ${d.shape.id} down, pointer #${e.pointer.id} (${e.pointer.kind})`,
      )
    }
    d.shape.onPointerMove = (e: PointerEvent2D): void => {
      if (d.activePointerId !== e.pointer.id) return
      d.shape.transform.x = e.pointer.world.x
      d.shape.transform.y = e.pointer.world.y
      d.trail.pushIfFar(e.pointer.world.x, e.pointer.world.y, 3)
    }
    d.shape.onPointerUp = (e: PointerEvent2D): void => {
      if (d.activePointerId !== e.pointer.id) return
      d.activePointerId = null
      console.info(
        `[demo-input] ${d.shape.id} up, pointer #${e.pointer.id} released`,
      )
    }
    d.shape.onPointerCancel = (e: PointerEvent2D): void => {
      if (d.activePointerId !== e.pointer.id) return
      d.activePointerId = null
      console.warn(
        `[demo-input] ${d.shape.id} cancel, pointer #${e.pointer.id} (source=${e.source})`,
      )
    }
  }

  // `D` destroys the first draggable mid-drag, verifying the
  // destroy-cascades-pointer-cancel invariant.
  const onKey = (e: KeyboardEvent): void => {
    if (e.key !== 'd' && e.key !== 'D') return
    const target = draggables[0]
    if (target.shape.isDestroyed) return
    console.info(`[demo-input] destroying ${target.shape.id}`)
    target.shape.destroy()
    target.trail.destroy()
  }
  window.addEventListener('keydown', onKey)
  stopHandlers.push(() => window.removeEventListener('keydown', onKey))

  const stop = (): void => {
    for (const fn of stopHandlers) fn()
    stopHandlers.length = 0
    host.destroy()
  }
  signal.addEventListener('abort', stop, { once: true })
  return stop
}

function makeDraggable(
  id: string,
  x: number,
  y: number,
  color: string,
): DraggableShape {
  const shape = new ShapeNode({
    id,
    geometry: { kind: 'circle', radius: 60 },
    fill: color,
    stroke: 'rgba(253, 246, 227, 0.8)',
    lineWidth: 2,
  })
  shape.transform.x = x
  shape.transform.y = y
  shape.hitEnabled = true

  const trail = new PolylineNode({
    id: `${id}:trail`,
    capacity: 512,
    strokeStyle: `${color}bb`,
    lineWidth: 6,
    smoothing: 'quadratic',
  })

  return {
    shape,
    trail,
    color,
    home: { x, y },
    activePointerId: null,
  }
}

export default runDemo
