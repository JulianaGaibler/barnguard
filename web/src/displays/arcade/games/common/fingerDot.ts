/**
 * A translucent dot standing in for a fingertip, for the tutorial demos.
 *
 * A dot rather than the shared `FingerHintNode` hand: at card size the hand
 * silhouette is too big to read as a gesture and it covers the very thing it is
 * pointing at. The dot pops in, travels, and fades, which is enough to say "put
 * a finger here and move it there".
 *
 * @example
 *   const dot = createFingerDot(cell * 0.3, COLORS.ink)
 *   root.add(dot)
 *   await showSwipe(dot, from, to)
 */
import { easings, ShapeNode } from '@src/stargazer'

/** A point in the demo stage's world units. */
export interface DotPoint {
  x: number
  y: number
}

/** How solid the dot reads over the board it is moving across. */
const DOT_ALPHA = 0.5
const POP_SEC = 0.22
const TRAVEL_SEC = 0.42
const FADE_SEC = 0.18

/** A hidden dot, ready to be shown. Add it to the demo's root. */
export function createFingerDot(radius: number, color: string): ShapeNode {
  const dot = new ShapeNode({
    geometry: { kind: 'circle', radius },
    fill: color,
  })
  dot.renderLayer = 'dynamic'
  dot.transform.alpha = 0
  dot.transform.scaleX = 0
  dot.transform.scaleY = 0
  return dot
}

/** Park the dot at `at`, invisible, before popping it in. */
function place(dot: ShapeNode, at: DotPoint): void {
  dot.transform.x = at.x
  dot.transform.y = at.y
  dot.transform.alpha = 0
  dot.transform.scaleX = 0
  dot.transform.scaleY = 0
}

const popIn = (dot: ShapeNode): Promise<void> =>
  dot.tween(
    { alpha: DOT_ALPHA, scaleX: 1, scaleY: 1 },
    { duration: POP_SEC, easing: easings.outBack },
  )

const fadeOut = (dot: ShapeNode): Promise<void> =>
  dot.tween({ alpha: 0 }, { duration: FADE_SEC })

/** Pop the dot in at `from`, drag it to `to`, and fade it back out. */
export async function showSwipe(
  dot: ShapeNode,
  from: DotPoint,
  to: DotPoint,
): Promise<void> {
  place(dot, from)
  await popIn(dot)
  await dot.tween(
    { x: to.x, y: to.y },
    { duration: TRAVEL_SEC, easing: easings.inOutCubic },
  )
  await fadeOut(dot)
}

/** Pop the dot in at `at`, press, and fade it out. */
export async function showTap(dot: ShapeNode, at: DotPoint): Promise<void> {
  place(dot, at)
  await popIn(dot)
  await dot.tween(
    { scaleX: 0.72, scaleY: 0.72 },
    { duration: 0.12, easing: easings.outQuad },
  )
  await dot.tween({ scaleX: 1, scaleY: 1 }, { duration: 0.12 })
  await fadeOut(dot)
}

/**
 * Pop the dot in at `from`, flick it to `to`, and fade it out.
 *
 * Faster and shorter than {@link showSwipe}, because a flick and a drag are
 * different gestures and a card teaching both has to tell them apart.
 */
export async function showFlick(
  dot: ShapeNode,
  from: DotPoint,
  to: DotPoint,
): Promise<void> {
  place(dot, from)
  await popIn(dot)
  await dot.tween(
    { x: to.x, y: to.y },
    { duration: TRAVEL_SEC * 0.4, easing: easings.inQuad },
  )
  await fadeOut(dot)
}
