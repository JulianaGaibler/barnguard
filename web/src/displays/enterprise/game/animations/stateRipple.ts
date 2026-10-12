import { Path2DNode, easings, ignoreAbort } from '@src/stargazer'
import type { RegionId } from '../maps/types'
import { TUNING } from '../data/tuning'

/**
 * Fire a ripple that flashes outward across the map. Every region's fill
 * flashes bright then fades, offset by `layers`, which holds the ripple depth
 * per region (`maps/ripple.ts` derives it from the map's neighbour graph, or
 * from distance when it has none).
 *
 * The flash is rendered as a temporary overlay `Path2DNode` cloned from the
 * region's own path, mounted on `'above-static'` so it doesn't churn the map's
 * static bake. Each overlay auto-destroys once its rise + fall tweens complete
 * (`riseSec` in, `fallSec` out, ~600 ms per region total).
 *
 * Called from `session` on region selection, collision, and border breach.
 * Fires in the background, the returned promise never rejects. Individual
 * pulses swallow `AbortError` via `ignoreAbort` so a mid-round teardown doesn't
 * produce console noise.
 */
export function fireStateRipple(
  layers: ReadonlyMap<RegionId, number>,
  regionNodes: ReadonlyMap<RegionId, Path2DNode>,
): void {
  const cfg = TUNING.stateRipple
  for (const [regionId, depth] of layers) {
    const regionNode = regionNodes.get(regionId)
    if (!regionNode) continue
    void pulseState(regionNode, depth * cfg.delayPerLayerSec)
  }
}

async function pulseState(
  stateNode: Path2DNode,
  delaySec: number,
): Promise<void> {
  const cfg = TUNING.stateRipple
  const parent = stateNode.parent
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
