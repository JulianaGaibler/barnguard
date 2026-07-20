import { createEngineHost } from '../engine/EngineHost'
import { SceneNode } from '../scene/SceneNode'
import { Path2DNode } from '../nodes/Path2DNode'
import { parseSvgPaths } from '../assets/SvgPathMap'
import { buildBitmapMask, type BitmapMask } from '../assets/BitmapMask'
import { AssetLoader } from '../assets/AssetLoader'
import type { DemoFn } from './types'

import shapesSvgRaw from '@src/stargazer/dev/fixtures/shapes.svg?raw'
import outlineSvgRaw from '@src/stargazer/dev/fixtures/outline.svg?raw'

const COLOR_STATE_FILL = '#354a6e'
const COLOR_STATE_HOVER = '#5c7fb0'
const COLOR_STATE_STROKE = 'rgba(253, 246, 227, 0.85)'
const COLOR_OUTLINE = 'rgba(253, 246, 227, 0.95)'

interface DemoAssets {
  states: ReturnType<typeof parseSvgPaths>
  outline: ReturnType<typeof parseSvgPaths>
  outlineMask: BitmapMask
}

const assetLoader = new AssetLoader()

async function loadAssets(): Promise<DemoAssets> {
  return assetLoader.load('demo-svg-assets', async () => {
    const states = parseSvgPaths(shapesSvgRaw)
    const outline = parseSvgPaths(outlineSvgRaw)
    // Use the outline SVG's viewBox as the mask's world extent so
    // BitmapMask.contains(worldX, worldY) speaks the same coord system as
    // the scene.
    const outlineEntry = firstPath(outline.paths)
    if (!outlineEntry) throw new Error('demo-svg: outline SVG has no <path>')
    const outlineMask = await buildBitmapMask({
      path: outlineEntry.path,
      worldRect: outline.viewBox,
      resolution: 1024,
    })
    return { states, outline, outlineMask }
  })
}

function firstPath(
  map: ReadonlyMap<string, { path: Path2D; bounds: unknown }>,
): { path: Path2D } | null {
  for (const entry of map.values()) return entry
  return null
}

const runDemo: DemoFn = async ({ canvas, signal, attach }) => {
  const host = createEngineHost({
    canvas,
    clearColor: '#0d1a2c',
    // Use the shapes SVG viewBox as the world viewport, the Camera's
    // uniform-fit centers the map in whatever landscape canvas we have.
    initialViewport: { x: 0, y: 0, width: 661, height: 899 },
  })
  attach?.(host)

  const overlay = createReadoutOverlay()

  let assets: DemoAssets | null = null
  overlay.setText('Loading map…')
  try {
    assets = await loadAssets()
  } catch (err) {
    overlay.setText(
      `Failed to load: ${err instanceof Error ? err.message : String(err)}`,
    )
    // Fall through, the engine still runs, just with an empty scene.
  }

  const stateNodes = new Map<string, Path2DNode>()
  await host.loadScene((scene) => {
    if (!assets) return
    const mapGroup = new SceneNode('map')
    scene.root.add(mapGroup)

    for (const [id, entry] of assets.states.paths) {
      const node = new Path2DNode({
        id: `state:${id}`,
        path: entry.path,
        fill: COLOR_STATE_FILL,
        stroke: COLOR_STATE_STROKE,
        lineWidth: 1,
        hitMode: 'fill',
        debugBounds: entry.bounds,
      })
      mapGroup.add(node)
      stateNodes.set(id, node)
    }

    // Country outline drawn on top so state borders don't overpaint the
    // coastline.
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
  })

  host.start()

  let hovered: string | null = null
  const setHover = (id: string | null): void => {
    if (hovered === id) return
    if (hovered) {
      const n = stateNodes.get(hovered)
      if (n) n.fill = COLOR_STATE_FILL
    }
    hovered = id
    if (hovered) {
      const n = stateNodes.get(hovered)
      if (n) n.fill = COLOR_STATE_HOVER
    }
  }

  const onPointerMove = (e: PointerEvent): void => {
    if (!assets) return
    const rect = canvas.getBoundingClientRect()
    const cssX = e.clientX - rect.left
    const cssY = e.clientY - rect.top
    const world = host.engine.camera.screenToWorld(cssX, cssY)
    // 1) Test each state's Path2DNode.hitTest (uses isPointInPath internally).
    let hit: string | null = null
    for (const [id, node] of stateNodes) {
      if (node.hitTest(world.x, world.y, 0)) {
        hit = id
        break
      }
    }
    setHover(hit)
    // 2) BitmapMask readout: is this world point inside the outline?
    const inside = assets.outlineMask.contains(world.x, world.y)
    const insideInset10 = assets.outlineMask.contains(world.x, world.y, 10)
    overlay.setLines([
      `hover:    ${hit ?? ';'}`,
      `world:    ${world.x.toFixed(1)}, ${world.y.toFixed(1)}`,
      `mask:     ${inside ? 'INSIDE' : 'outside'}`,
      `mask+10:  ${insideInset10 ? 'INSIDE' : 'outside'}`,
    ])
  }
  const onPointerLeave = (): void => {
    setHover(null)
    if (assets) {
      overlay.setLines([
        `hover:    ;`,
        `world:    ;`,
        `mask:     ;`,
        `mask+10:  ;`,
      ])
    }
  }
  canvas.addEventListener('pointermove', onPointerMove)
  canvas.addEventListener('pointerleave', onPointerLeave)

  if (assets) onPointerLeave()

  const stop = (): void => {
    canvas.removeEventListener('pointermove', onPointerMove)
    canvas.removeEventListener('pointerleave', onPointerLeave)
    overlay.destroy()
    host.destroy()
  }
  signal.addEventListener('abort', stop, { once: true })
  return stop
}

interface ReadoutOverlay {
  setText(text: string): void
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
    minWidth: '200px',
  } satisfies Partial<CSSStyleDeclaration>)
  document.body.appendChild(el)
  return {
    setText(text) {
      el.textContent = text
    },
    setLines(lines) {
      el.textContent = lines.join('\n')
    },
    destroy() {
      el.remove()
    },
  }
}

export default runDemo
