import { createEngineHost } from '../engine/EngineHost'
import { addDemoCamera } from './demoCamera'
import { Node2D } from '../scene/Node2D'
import { Layer } from '../scene/Layer'
import { Path2DNode } from '../nodes/Path2DNode'
import { ShapeNode } from '../nodes/ShapeNode'
import { parseSvgPaths } from '../assets/SvgPathMap'
import { AssetLoader } from '../assets/AssetLoader'
import { ignoreAbort } from '../anim/abortSignal'
import { inOutQuad, outBack } from '../math/easings'
import type { Rect } from '../math/Rect'
import type { DemoFn } from './types'

import shapesSvgRaw from '@src/stargazer/dev/fixtures/shapes.svg?raw'
import outlineSvgRaw from '@src/stargazer/dev/fixtures/outline.svg?raw'

const COLOR_STATE_FILL = '#354a6e'
const COLOR_STATE_STROKE = 'rgba(253, 246, 227, 0.85)'
const COLOR_OUTLINE = 'rgba(253, 246, 227, 0.95)'
const COLOR_PULSE = '#ffd34d'

const COLOR_HUD = 'rgba(255, 211, 77, 0.85)'
const COLOR_FRAME = 'rgba(96, 165, 250, 0.9)'

/** The design rect the framed layer is laid out for, in its own units. */
const DESIGN_FRAME: Rect = { x: 0, y: 0, width: 1920, height: 1080 }

const FULL_VIEW: Rect = { x: 0, y: 0, width: 600, height: 400 }
const UPPER_HALF: Rect = { x: 0, y: -10, width: 600, height: 220 }
const LOWER_HALF: Rect = { x: 0, y: 190, width: 600, height: 220 }

interface DemoAssets {
  states: ReturnType<typeof parseSvgPaths>
  outline: ReturnType<typeof parseSvgPaths>
}

const assetLoader = new AssetLoader()

async function loadAssets(): Promise<DemoAssets> {
  return assetLoader.load('demo-camera-assets', async () => {
    return {
      states: parseSvgPaths(shapesSvgRaw, { tessellate: true }),
      outline: parseSvgPaths(outlineSvgRaw, { tessellate: true }),
    }
  })
}

/**
 * Camera demo. A shape map, a camera tween on click, and a pulse on a hovered
 * shape.
 *
 * - Click a shape and the camera tweens to the upper or lower half viewport over
 *   roughly 500 ms.
 * - Press `P` while hovering a shape to pulse its alpha.
 * - Press `Escape` to return to the full view.
 * - The gold chip in the top left is a `'screen'` layer, and the blue frame is a
 *   layer fitted to a 1920 by 1080 design. Neither follows the camera, so they
 *   stay put while the map pans and zooms underneath.
 */
const runDemo: DemoFn = async ({ canvas, signal, attach }) => {
  const host = createEngineHost({
    canvas,
    clearColor: '#0d1a2c',
  })
  attach?.(host)

  const overlay = createReadoutOverlay()
  overlay.setLines(['Loading map…'])

  let assets: DemoAssets | null = null
  try {
    assets = await loadAssets()
  } catch (err) {
    overlay.setLines([
      `Failed to load: ${err instanceof Error ? err.message : String(err)}`,
    ])
  }

  const stateNodes = new Map<string, Path2DNode>()
  const stateCenters = new Map<string, { x: number; y: number }>()

  await host.loadScene((scene) => {
    addDemoCamera(scene, { ...FULL_VIEW })
    if (!assets) return
    const mapGroup = new Node2D('map')
    scene.root.add(mapGroup)

    for (const [id, entry] of assets.states.paths) {
      const node = new Path2DNode({
        id: `state:${id}`,
        path: entry.path,
        fill: COLOR_STATE_FILL,
        stroke: COLOR_STATE_STROKE,
        lineWidth: 1,
        hitMode: 'fill',
        bounds: entry.bounds,
      })
      mapGroup.add(node)
      stateNodes.set(id, node)
      stateCenters.set(id, {
        x: entry.bounds.x + entry.bounds.width / 2,
        y: entry.bounds.y + entry.bounds.height / 2,
      })
    }

    const outlineEntry = firstPath(assets.outline.paths)
    if (outlineEntry) {
      const outlineNode = new Path2DNode({
        id: 'outline',
        path: outlineEntry.path,
        stroke: COLOR_OUTLINE,
        lineWidth: 1.5,
        hitMode: 'none',
      })
      mapGroup.add(outlineNode)
    }

    // Two layers placed by their own views, so the camera does not move them.
    const hud = new Layer({ id: 'hud', space: 'screen' })
    const chip = new ShapeNode({
      geometry: {
        kind: 'rect',
        width: 160,
        height: 36,
        centered: false,
        radii: 18,
      },
      fill: COLOR_HUD,
    })
    chip.transform.x = 16
    chip.transform.y = 16
    hud.add(chip)
    scene.root.add(hud)

    const framed = new Layer({ id: 'frame', space: { frame: DESIGN_FRAME } })
    const border = new ShapeNode({
      geometry: {
        kind: 'rect',
        width: DESIGN_FRAME.width,
        height: DESIGN_FRAME.height,
        centered: false,
      },
      stroke: COLOR_FRAME,
      lineWidth: 2,
    })
    framed.add(border)
    scene.root.add(framed)
  })

  host.start()

  let hovered: string | null = null
  const setHover = (id: string | null): void => {
    if (hovered === id) return
    hovered = id
    updateOverlay()
  }
  const updateOverlay = (): void => {
    overlay.setLines([
      `hover:    ${hovered ?? ';'}`,
      `click:    zoom to shape's half of the map`,
      `[P]:      pulse hovered state (shockwave demo)`,
      `[Escape]: reset to full view`,
    ])
  }
  if (assets) updateOverlay()

  const findStateAt = (worldX: number, worldY: number): string | null => {
    for (const [id, node] of stateNodes) {
      if (node.hitTest(worldX, worldY, 0)) return id
    }
    return null
  }

  const onPointerMove = (e: PointerEvent): void => {
    if (!assets) return
    const rect = canvas.getBoundingClientRect()
    const w = host.engine.activeCamera?.screenToWorld(
      e.clientX - rect.left,
      e.clientY - rect.top,
    ) ?? { x: 0, y: 0 }
    setHover(findStateAt(w.x, w.y))
  }
  const onPointerLeave = (): void => setHover(null)

  let currentTween: AbortController | null = null
  const zoomTo = async (target: Rect): Promise<void> => {
    currentTween?.abort()
    currentTween = new AbortController()
    const signal = currentTween.signal
    try {
      await host.engine.currentCamera2D?.animateTo(target, {
        duration: 0.5,
        easing: inOutQuad,
        signal,
      })
    } catch (err) {
      ignoreAbort(err)
    }
  }

  const onPointerDown = (e: PointerEvent): void => {
    if (!assets) return
    const rect = canvas.getBoundingClientRect()
    const w = host.engine.activeCamera?.screenToWorld(
      e.clientX - rect.left,
      e.clientY - rect.top,
    ) ?? { x: 0, y: 0 }
    const hit = findStateAt(w.x, w.y)
    if (!hit) return
    const c = stateCenters.get(hit)
    if (!c) return
    // Below-midpoint states crop to the lower half, others to the upper half.
    const targetView = c.y > FULL_VIEW.height / 2 ? LOWER_HALF : UPPER_HALF
    void zoomTo(targetView)
  }

  const activePulses = new Set<string>()
  const pulseState = async (id: string): Promise<void> => {
    if (activePulses.has(id)) return
    const node = stateNodes.get(id)
    if (!node) return
    activePulses.add(id)
    const originalFill = node.fill
    node.fill = COLOR_PULSE
    try {
      await node.tween({ alpha: 0.55 }, { duration: 0.18, easing: outBack })
      await node.tween({ alpha: 1 }, { duration: 0.32, easing: inOutQuad })
    } catch (err) {
      ignoreAbort(err)
    } finally {
      node.fill = originalFill
      activePulses.delete(id)
    }
  }

  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'p' || e.key === 'P') {
      if (hovered) void pulseState(hovered)
      return
    }
    if (e.key === 'Escape') {
      void zoomTo(FULL_VIEW)
      return
    }
  }

  canvas.addEventListener('pointermove', onPointerMove)
  canvas.addEventListener('pointerleave', onPointerLeave)
  canvas.addEventListener('pointerdown', onPointerDown)
  window.addEventListener('keydown', onKey)

  const stop = (): void => {
    canvas.removeEventListener('pointermove', onPointerMove)
    canvas.removeEventListener('pointerleave', onPointerLeave)
    canvas.removeEventListener('pointerdown', onPointerDown)
    window.removeEventListener('keydown', onKey)
    overlay.destroy()
    host.destroy()
  }
  signal.addEventListener('abort', stop, { once: true })
  return stop
}

function firstPath(
  map: ReadonlyMap<string, { path: Path2D; bounds: unknown }>,
): { path: Path2D } | null {
  for (const entry of map.values()) return entry
  return null
}

interface ReadoutOverlay {
  setLines(lines: string[]): void
  destroy(): void
}

function createReadoutOverlay(): ReadoutOverlay {
  const el = document.createElement('div')
  Object.assign(el.style, {
    position: 'fixed',
    right: '16px',
    bottom: '16px',
    padding: '10px 12px',
    background: 'rgba(0, 0, 0, 0.72)',
    color: '#fdf6e3',
    font: '12px/1.5 monospace',
    borderRadius: '4px',
    border: '1px solid rgba(255, 255, 255, 0.15)',
    zIndex: '9999',
    pointerEvents: 'none',
    whiteSpace: 'pre',
    minWidth: '260px',
  } satisfies Partial<CSSStyleDeclaration>)
  document.body.appendChild(el)
  return {
    setLines(lines) {
      el.textContent = lines.join('\n')
    },
    destroy() {
      el.remove()
    },
  }
}

export default runDemo
