import {
  AbortScope,
  Layer,
  ShapeNode,
  easings,
  ignoreAbort,
  type Rect,
} from '@src/stargazer'
import { DESIGN_HEIGHT, DESIGN_WIDTH } from '@src/core/ui/designRegion'
import { PALETTE } from '../theme'
import { accentDither, backgroundDither } from './ditherLook'
import {
  MOTION,
  SPLASH_POSE,
  lerp,
  reachable,
  spotCenter,
  spotSize,
  wrapEdge,
  type Pose,
} from './motion'
import type { Tweener } from './trailView'

/** The color of a spot at its center. Its alpha falls to 0 at the rim. */
const SPOT_RIM = 'rgba(22, 22, 22, 0)'
const spotCenterColor = (strength: number): string =>
  `rgba(22, 22, 22, ${strength})`

/** How much denser and fuller the dots get at the height of a swell. */
const SWELL_DOT_SCALE = 0.88
const SWELL_GAMMA = 1.15

/** The field behind the screens, which moves between poses. */
export interface Background {
  /** The two dark red spots. */
  readonly layer: Layer
  /** The orange spot, lit only for a moment. Add it just above `layer`. */
  readonly accent: Layer
  /** Fits the spots to the corners of `area`, the world the window shows. */
  fit(area: Rect): void
  /**
   * Moves the spots to `pose`, the short way round the edge. With `swell` the
   * dots grow fuller for the length of the move, and then settle.
   */
  to(pose: Pose, opts?: { duration?: number; swell?: boolean }): void
  destroy(): void
}

/** The numbers a pose is tweened through. */
interface PoseState {
  u0: number
  r0: number
  s0: number
  u1: number
  r1: number
  s1: number
  ua: number
  ra: number
  sa: number
}

const toState = (pose: Pose): PoseState => ({
  u0: pose.spots[0].u,
  r0: pose.spots[0].radius,
  s0: pose.spots[0].strength,
  u1: pose.spots[1].u,
  r1: pose.spots[1].radius,
  s1: pose.spots[1].strength,
  ua: pose.accent.u,
  ra: pose.accent.radius,
  sa: pose.accent.strength,
})

const toPose = (state: PoseState): Pose => ({
  spots: [
    { u: state.u0, radius: state.r0, strength: state.s0 },
    { u: state.u1, radius: state.r1, strength: state.s1 },
  ],
  accent: { u: state.ua, radius: state.ra, strength: state.sa },
})

/**
 * The field behind the screens: dark spots on white, which the dither turns
 * into dots that thin out away from the edge. The spots sit on the edge of the
 * visible area, so they travel round the screen and never across the text.
 *
 * Between moves nothing changes, so the layers keep their render and draw it as
 * one quad. While a pose or a swell plays, the layers render every frame, which
 * is cheap. Add the layers to the scene first, so they draw under everything
 * else.
 */
export function createBackground(engine: Tweener): Background {
  const frame = { x: 0, y: 0, width: DESIGN_WIDTH, height: DESIGN_HEIGHT }
  const baseDither = backgroundDither()
  const accentFx = accentDither()
  const layer = new Layer({
    id: 'background',
    space: { frame },
    region: 'view',
    cache: 'raster',
    clearColor: PALETTE.white,
    effects: [baseDither],
    persistent: true,
  })
  const accent = new Layer({
    id: 'background-accent',
    space: { frame },
    region: 'view',
    cache: 'raster',
    clearColor: PALETTE.white,
    effects: [accentFx],
    persistent: true,
  })
  accent.visible = false

  const spot = (into: Layer): ShapeNode => {
    const node = new ShapeNode({
      geometry: { kind: 'rect', width: 1, height: 1, centered: false },
    })
    into.add(node)
    return node
  }
  const nodes = [spot(layer), spot(layer)] as const
  const accentNode = spot(accent)

  const scope = new AbortScope()
  const state = toState(SPLASH_POSE)
  let area: Rect = { ...frame }
  const dotScale = baseDither.settings.dotScale
  const gamma = baseDither.settings.gamma

  /** Draws one spot as a radial gradient over the whole area. */
  const paint = (
    node: ShapeNode,
    u: number,
    radius: number,
    strength: number,
  ): void => {
    const at = spotCenter(u, area.width, area.height)
    node.transform.x = area.x
    node.transform.y = area.y
    node.geometry = {
      kind: 'rect',
      width: area.width,
      height: area.height,
      centered: false,
    }
    node.fill = {
      kind: 'radial',
      cx: at.x,
      cy: at.y,
      r: radius * spotSize(u),
      stops: [
        { offset: 0, color: spotCenterColor(strength) },
        { offset: 1, color: SPOT_RIM },
      ],
    }
  }

  const render = (): void => {
    paint(nodes[0], state.u0, state.r0, state.s0)
    paint(nodes[1], state.u1, state.r1, state.s1)
    paint(accentNode, state.ua, state.ra, state.sa)
    // A layer nobody can see should not take a surface.
    accent.visible = state.sa > 0.001
  }

  const swell = (seconds: number): void => {
    const level = { k: 0 }
    const apply = (): void => {
      for (const fx of [baseDither, accentFx]) {
        fx.settings.dotScale = lerp(dotScale, SWELL_DOT_SCALE, level.k)
        fx.settings.gamma = lerp(gamma, SWELL_GAMMA, level.k)
      }
    }
    void engine
      .tween(
        level,
        { k: 1 },
        {
          duration: seconds / 2,
          easing: easings.outCubic,
          onUpdate: apply,
          key: 'swell',
          signal: scope.signal,
        },
      )
      .then(() =>
        engine.tween(
          level,
          { k: 0 },
          {
            duration: seconds / 2,
            easing: easings.inCubic,
            onUpdate: apply,
            key: 'swell',
            signal: scope.signal,
          },
        ),
      )
      .catch(ignoreAbort)
  }

  render()
  return {
    layer,
    accent,
    fit(next) {
      area = { ...next }
      render()
    },
    to(pose, opts = {}) {
      const target = toState(reachable(toPose(state), pose))
      void engine
        .tween(state, target, {
          duration: opts.duration ?? MOTION.background,
          easing: easings.inOutCubic,
          onUpdate: render,
          key: 'pose',
          signal: scope.signal,
        })
        .then(() => {
          // Back into 0..4, which is the same place on the loop.
          state.u0 = wrapEdge(state.u0)
          state.u1 = wrapEdge(state.u1)
          state.ua = wrapEdge(state.ua)
        })
        .catch(ignoreAbort)
      if (opts.swell) swell(MOTION.swell * 2)
    },
    destroy() {
      scope.dispose()
      layer.destroy()
      accent.destroy()
    },
  }
}
