import {
  Path2DNode,
  easings,
  ignoreAbort,
  type SceneNode,
} from '@src/stargazer'
import { bfsLayers } from '../data/adjacency'
import type { StateId } from '../data/states'
import { TUNING } from '../data/tuning'

/**
 * Fire a ripple that flashes through the state graph in BFS order from
 * `origin`. Every state's fill flashes bright then fades, the origin at `t =
 * 0`, each subsequent BFS layer offset by
 * `TUNING.stateRipple.delayPerLayerSec`.
 *
 * The flash is rendered as a temporary overlay `Path2DNode` cloned from the
 * state's own path, mounted on `'above-static'` so it doesn't churn the map's
 * static bake. Each overlay auto-destroys once its rise + fall tweens complete
 * (`riseSec` in, `fallSec` out, ~600 ms per state total).
 *
 * Called from `session` on state selection, collision, and border breach. Fires
 * in the background, the returned promise never rejects; individual per-state
 * pulses swallow `AbortError` via `ignoreAbort` so a mid-round teardown doesn't
 * produce console noise.
 */
export function fireStateRipple(
  origin: StateId,
  stateNodes: ReadonlyMap<StateId, Path2DNode>,
): void {
  // Depth cap sized well above the graph's diameter so every reachable
  // state gets a chance to ripple. 20 is comfortably beyond the six or so
  // hops that Germany's neighbour graph actually spans.
  const layers = bfsLayers(origin, 20)
  layers.set(origin, 0)
  const cfg = TUNING.stateRipple
  for (const [stateId, depth] of layers) {
    const stateNode = stateNodes.get(stateId)
    if (!stateNode) continue
    void pulseState(stateNode, depth * cfg.delayPerLayerSec)
  }
}

async function pulseState(
  stateNode: Path2DNode,
  delaySec: number,
): Promise<void> {
  const cfg = TUNING.stateRipple
  const parent: SceneNode | null = stateNode.parent
  if (!parent) return

  try {
    if (delaySec > 0) await stateNode.wait(delaySec)

    // Clone the state's Path2D into a temporary overlay. Sits on the
    // `'above-static'` layer so its lifecycle doesn't invalidate the map's
    // static bake, the layer's neither present at add time nor at
    // destroy time as far as the bake is concerned.
    const overlay = new Path2DNode({
      id: `ripple:${stateNode.id}`,
      path: stateNode.path,
      fill: cfg.color,
      hitMode: 'none',
    })
    overlay.transform.alpha = 0
    overlay.renderLayer = 'above-static'
    parent.add(overlay)

    // `autoDestroy` handles the "tween → destroy" pair. Chain the two
    // tweens via .then so both finish before destroy fires.
    await overlay.autoDestroy(
      overlay
        .tween(
          { alpha: cfg.peakAlpha },
          { duration: cfg.riseSec, easing: easings.outCubic },
        )
        .then(() =>
          overlay.tween(
            { alpha: 0 },
            { duration: cfg.fallSec, easing: easings.outQuad },
          ),
        ),
    )
  } catch (err) {
    ignoreAbort(err)
  }
}
