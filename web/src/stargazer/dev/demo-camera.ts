import { createEngineHost } from '../engine/EngineHost'
import { GroupNode } from '../nodes/GroupNode'
import { Path2DNode } from '../nodes/Path2DNode'
import { parseSvgPaths } from '../assets/SvgPathMap'
import { AssetLoader } from '../assets/AssetLoader'
import { ignoreAbort } from '../anim/abortSignal'
import { inOutQuad, outBack } from '../math/easings'
import type { Rect } from '../math/Rect'
import type { DemoFn } from './types'

import statesSvgRaw from '@src/assets/de-states.svg?raw'
import outlineSvgRaw from '@src/assets/de-outline.svg?raw'

const COLOR_STATE_FILL = '#354a6e'
const COLOR_STATE_STROKE = 'rgba(253, 246, 227, 0.85)'
const COLOR_OUTLINE = 'rgba(253, 246, 227, 0.95)'
const COLOR_PULSE = '#ffd34d'

const FULL_VIEW: Rect = { x: 0, y: 0, width: 661, height: 899 }
const UPPER_HALF: Rect = { x: 0, y: -20, width: 661, height: 520 }
const LOWER_HALF: Rect = { x: 0, y: 380, width: 661, height: 520 }

interface DemoAssets {
  states: ReturnType<typeof parseSvgPaths>
  outline: ReturnType<typeof parseSvgPaths>
}

const assetLoader = new AssetLoader()

async function loadAssets(): Promise<DemoAssets> {
  return assetLoader.load('demo-camera-assets', async () => {
    return {
      states: parseSvgPaths(statesSvgRaw),
      outline: parseSvgPaths(outlineSvgRaw),
    }
  })
}

/**
 * M8 demo. Germany map on the `'static'` layer + camera tween on click +
 * shockwave via `renderLayer` promotion.
 *
 * - The map is drawn every frame the camera is stable via a cheap `drawImage`
 *   blit from the offscreen bake canvas. Verify by watching "Static bakes/s: 0"
 *   in the debug HUD (Scene section).
 * - Click a state → camera tweens to the upper- or lower-half viewport over ~500
 *   ms; during the tween the cache is skipped and the static layer is drawn
 *   fresh each frame. Bakes/s temporarily jumps to 0 → stays 0 (fresh draws
 *   don't bake) → 1 exactly on the settle frame.
 * - Press `P` while hovering a state to pulse its alpha (promote → tween 1→0.7→1
 *   → demote). HUD shows exactly `Static bakes total` +2 for the whole pulse.
 * - Press `Escape` to return to the full-Germany view.
 */
const runDemo: DemoFn = async ({ canvas, signal, attach }) => {
  const host = createEngineHost({
    canvas,
    clearColor: '#0d1a2c',
    initialViewport: { ...FULL_VIEW },
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
    if (!assets) return
    const mapGroup = new GroupNode('map')
    mapGroup.renderLayer = 'static'
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
      // Explicit static (inherited from parent implicitly wouldn't invalidate
      // on individual state promotion, we need each state node to own its
      // own renderLayer so its setter triggers `scene.invalidateStatic()`).
      node.renderLayer = 'static'
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
      outlineNode.renderLayer = 'static'
      mapGroup.add(outlineNode)
    }
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
      `click:    zoom to state's half of Germany`,
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
    const w = host.engine.activeCamera.screenToWorld(
      e.clientX - rect.left,
      e.clientY - rect.top,
    )
    setHover(findStateAt(w.x, w.y))
  }
  const onPointerLeave = (): void => setHover(null)

  let currentTween: AbortController | null = null
  const zoomTo = async (target: Rect): Promise<void> => {
    currentTween?.abort()
    currentTween = new AbortController()
    const signal = currentTween.signal
    try {
      await host.engine.camera.animateTo(target, {
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
    const w = host.engine.activeCamera.screenToWorld(
      e.clientX - rect.left,
      e.clientY - rect.top,
    )
    const hit = findStateAt(w.x, w.y)
    if (!hit) return
    const c = stateCenters.get(hit)
    if (!c) return
    // Below-midpoint states → lower-half crop; else upper-half.
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
    node.renderLayer = 'above-static' // triggers 1 static re-bake without this state
    try {
      await node.tween({ alpha: 0.55 }, { duration: 0.18, easing: outBack })
      await node.tween({ alpha: 1 }, { duration: 0.32, easing: inOutQuad })
    } catch (err) {
      ignoreAbort(err)
    } finally {
      node.fill = originalFill
      node.renderLayer = 'static' // triggers 1 static re-bake with this state back
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
