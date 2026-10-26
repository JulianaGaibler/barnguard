import {
  AbortScope,
  Layer,
  Node2D,
  ShapeNode,
  easings,
  ignoreAbort,
  type Rect,
} from 'stargazer'
import type { Dither } from '@src/core/render/dither'
import { PALETTE } from '../theme'
import { DecorLayer, type DecorShape } from './decor'
import { accentDither, backgroundDither, FixedCells } from './ditherLook'
import { pickFrame } from './frame'
import {
  MOODS,
  blendMood,
  blendsThroughGrey,
  moodNamed,
  type FieldLook,
  type Mood,
} from './moods'
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
  `rgba(22, 22, 22, ${Math.min(Math.max(strength, 0), 1).toFixed(4)})`

/** How much bigger and fuller the dots get at the height of a swell. */
const SWELL_DOT_GROWTH = 0.1
const SWELL_GAMMA = 1.15

/** The farthest a fully shaken spot moves, in design pixels. */
const SHAKE_MOVE = 16
/** How much a fully shaken spot's radius wobbles, as a fraction of it. */
const SHAKE_SIZE = 0.05
/** How much bigger a spot is at full tension, as a fraction of its radius. */
const SHAKE_GROWTH = 0.6
/** The slowest and the fastest the shake runs, in radians a second. */
const SHAKE_SLOW = 0.5
const SHAKE_FAST = 4
/** How the speed grows with the level, so only the top is quick. */
const SHAKE_CURVE = 3
/** The size of the circle of a touch, as a share of the shorter side. */
const TOUCH_FROM = 0.25
const TOUCH_TO = 1.7
/**
 * The shaft of light through the kitchen door: a right triangle in the top
 * right corner, with one side down the right edge of the screen and one along
 * the bottom, and its point at the top. The point and the far end of the base,
 * as fractions of the area, a little past the edges so none shows a seam, how
 * how quickly its strength dies away from the top toward the base, and how many
 * rows stack up to draw it.
 */
const SHAFT = {
  apex: { x: 1.01, y: -0.01 },
  base: { x: 0.7, y: 1.01 },
  fizzle: 1.2,
  /** What is left of the strength at the base, so the dots reach the bottom. */
  tail: 0.22,
  strips: 64,
}
/** How far through a blend the text and the background have left the grey. */
const GREY_PASSED = 0.7

/**
 * Calls `onStep` with a phase every frame while `amount` is above zero. The
 * phase advances faster as `amount` grows, so a slow shake glides and only the
 * strongest is quick, and a change of `amount` never jumps.
 */
class Shaker extends Node2D {
  amount = 0
  readonly #onStep: (phase: number) => void
  #phase = 0

  constructor(onStep: (phase: number) => void) {
    super('background-shaker')
    this.#onStep = onStep
  }

  override onUpdate(dt: number): void {
    if (this.amount <= 0) return
    const speed =
      SHAKE_SLOW + (SHAKE_FAST - SHAKE_SLOW) * this.amount ** SHAKE_CURVE
    this.#phase += dt * speed
    this.#onStep(this.#phase)
  }
}

/** The field behind the screens, which moves between poses. */
export interface Background {
  /** The first two spots, over the mood's color. */
  readonly layer: Layer
  /** The third spot, in the mood's second color. Add it just above `layer`. */
  readonly accent: Layer
  /** The fields of the mood's shapes. Add them just above `accent`. */
  readonly decor: readonly Layer[]
  /** The dithers' cells, which keep their size on screen. */
  readonly cells: readonly FixedCells[]
  /** Fits the spots to the corners of `area`, the world the window shows. */
  fit(area: Rect): void
  /**
   * Moves the spots to `pose`, the short way round the edge. With `swell` the
   * dots grow fuller for the length of the move, and then settle.
   */
  to(pose: Pose, opts?: { duration?: number; swell?: boolean }): void
  /** Swells a warm circle in the middle, over `seconds`, then lets it go. */
  touch(seconds: number): void
  /** The mood now, part of the way between two while one is blending. */
  readonly mood: Mood
  /**
   * Blends to the mood called `name`, or the booth's for none. Without a
   * duration it is there at once. `agitation`, 0 to 1 and 1 by default, is how
   * much of the mood's shake plays, and it eases there over the same duration.
   * Returns the seconds a screen's words should wait before they show: none,
   * unless the text would be unreadable partway through the blend, as from a
   * light mood to a dark one.
   */
  setMood(
    name: string | undefined,
    opts?: { duration?: number; agitation?: number },
  ): number
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
 * into halftone dots that shrink away from the edge. The spots sit on the edge
 * of the visible area, so they travel round the screen and never across the
 * text. The mood sets the color behind, the color and shape of the dots, and
 * how much the spots shake.
 *
 * Between moves nothing changes, so the layers keep their render and draw it as
 * one quad. While a pose or a swell plays, the layers render every frame, which
 * is cheap. Add the layers to the scene first, so they draw under everything
 * else.
 */
export function createBackground(
  engine: Tweener,
  onMood: (mood: Mood) => void = () => {},
): Background {
  const baseDither = backgroundDither()
  const accentFx = accentDither()
  const cells = [new FixedCells(baseDither), new FixedCells(accentFx)]
  const layer = new Layer({
    id: 'background',
    space: { frame: pickFrame },
    region: 'view',
    cache: 'raster',
    clearColor: PALETTE.white,
    holdUntilEffects: true,
    effects: [baseDither],
    persistent: true,
  })
  const accent = new Layer({
    id: 'background-accent',
    space: { frame: pickFrame },
    region: 'view',
    cache: 'raster',
    clearColor: PALETTE.white,
    holdUntilEffects: true,
    effects: [accentFx],
    persistent: true,
  })
  accent.visible = false
  let decorTime = 0
  const decorLayer = new DecorLayer((time) => {
    decorTime = time
    drawDecor()
  })
  layer.add(decorLayer.clock)

  const spot = (into: Layer): ShapeNode => {
    const node = new ShapeNode({
      geometry: { kind: 'rect', width: 1, height: 1, centered: false },
    })
    into.add(node)
    return node
  }
  const nodes = [spot(layer), spot(layer)] as const
  const accentNode = spot(accent)
  // The shaft is a stack of rows, each a little wider than the one above.
  const shaftRows = Array.from({ length: SHAFT.strips }, () => {
    const row = new ShapeNode({
      geometry: { kind: 'rect', width: 1, height: 1, centered: false },
    })
    row.visible = false
    accent.add(row)
    return row
  })

  const scope = new AbortScope()
  const state = toState(SPLASH_POSE)
  let area: Rect = pickFrame(0, 0)
  const gamma = baseDither.settings.gamma
  let mood: Mood = MOODS.booth
  let moodTarget: Mood = MOODS.booth
  let swellLevel = 0
  const agitation = { k: 1 }

  /** Where the shake has put each spot, and how big it has made it. */
  const shaken = [0, 1, 2].map(() => ({ x: 0, y: 0, size: 1 }))
  const shakeLevel = (): number => mood.ragged * agitation.k
  const shaker = new Shaker((phase) => {
    const amount = shakeLevel()
    // Two slow waves each, at unrelated rates, so no spot repeats itself soon.
    const wave = (rate: number, offset: number): number =>
      0.6 * Math.sin(phase * rate + offset) +
      0.4 * Math.sin(phase * rate * 1.73 + offset * 2.3)
    shaken.forEach((spotShake, i) => {
      spotShake.x = wave(1, i * 2.1) * SHAKE_MOVE * amount
      spotShake.y = wave(0.83, i * 3.7 + 1) * SHAKE_MOVE * amount
      spotShake.size =
        1 +
        SHAKE_GROWTH * amount +
        wave(1.21, i * 5.3 + 2) * SHAKE_SIZE * amount
    })
    render()
  })
  layer.add(shaker)

  /** Draws one spot as a radial gradient over the whole area. */
  const paint = (
    node: ShapeNode,
    index: number,
    u: number,
    radius: number,
    strength: number,
    look: FieldLook,
  ): void => {
    node.transform.x = area.x
    node.transform.y = area.y
    node.geometry = {
      kind: 'rect',
      width: area.width,
      height: area.height,
      centered: false,
    }
    node.visible = look.shape !== 'beam'
    const beam = look.shape === 'beam' && node === accentNode
    for (const row of shaftRows) row.visible = beam
    if (beam) {
      const { apex, base, fizzle, tail, strips } = SHAFT
      const top = apex.y * area.height
      const rowHeight = ((base.y - apex.y) * area.height) / strips
      shaftRows.forEach((row, i) => {
        const t = (i + 0.5) / strips
        const x0 = lerp(apex.x, base.x, t) * area.width
        const x1 = apex.x * area.width
        row.transform.x = area.x + x0
        row.transform.y = area.y + top + i * rowHeight
        row.geometry = {
          kind: 'rect',
          width: x1 - x0,
          height: rowHeight + 1,
          centered: false,
        }
        // Brightest at the door, and dying away down the floor.
        row.fill = spotCenterColor(
          strength * (tail + (1 - tail) * (1 - t) ** fizzle),
        )
      })
      return
    }
    const at = spotCenter(u, area.width, area.height)
    const shake = shaken[index]!
    node.fill = {
      kind: 'radial',
      cx: at.x + shake.x,
      cy: at.y + shake.y,
      r: radius * spotSize(u) * shake.size,
      stops: [
        { offset: 0, color: spotCenterColor(strength) },
        { offset: 1, color: SPOT_RIM },
      ],
    }
  }

  const touching = { k: 0, on: false }
  const drawDecor = (): void => {
    const decor = mood.decor
    const shapes = decor?.shapes ?? []
    // The circle of a touch rises and falls once while it grows.
    const touch: DecorShape[] = touching.on
      ? [
          {
            shape: 'circle',
            field: 2,
            x: 0.5,
            y: 0.5,
            w: lerp(TOUCH_FROM, TOUCH_TO, easings.outCubic(touching.k)),
            tone: Math.sin(Math.PI * touching.k),
            steady: true,
            underText: true,
          },
        ]
      : []
    decorLayer.draw([...shapes, ...touch], decor?.fields ?? [], area, decorTime)
  }

  const render = (): void => {
    const { base, accent: accentLook } = mood
    paint(nodes[0], 0, state.u0, state.r0, state.s0 * base.strength, base)
    paint(nodes[1], 1, state.u1, state.r1, state.s1 * base.strength, base)
    const lit = Math.max(state.sa, accentLook.rest) * accentLook.strength
    paint(accentNode, 2, state.ua, state.ra, lit, accentLook)
    // A layer nobody can see should not take a surface.
    accent.visible = lit > 0.001
    drawDecor()
  }

  /** Writes the mood and the swell to the dithers. */
  const applySettings = (): void => {
    const fields: Array<[Dither, FieldLook, FixedCells]> = [
      [baseDither, mood.base, cells[0]!],
      [accentFx, mood.accent, cells[1]!],
    ]
    for (const [fx, look, fixed] of fields) {
      fx.settings.ink = look.ink
      fx.settings.dot = look.dot
      fx.settings.dotScale = look.gain * (1 + SWELL_DOT_GROWTH * swellLevel)
      fx.settings.gamma = lerp(gamma, SWELL_GAMMA, swellLevel)
      fixed.setDesign(look.cell)
    }
    baseDither.settings.paper = mood.background
    mood.decor?.fields.forEach((look, i) => {
      const fx = decorLayer.dithers[i]!
      fx.settings.ink = look.ink
      fx.settings.dot = look.dot
      fx.settings.dotScale = look.gain
      decorLayer.cells[i]!.setDesign(look.cell)
    })
  }

  /** Hands the shake's level to the shaker, and rests the spots at zero. */
  const setShake = (): void => {
    shaker.amount = shakeLevel()
    if (shaker.amount <= 0) {
      for (const spotShake of shaken) {
        spotShake.x = 0
        spotShake.y = 0
        spotShake.size = 1
      }
    }
  }

  const applyMood = (next: Mood): void => {
    mood = next
    setShake()
    applySettings()
    render()
    onMood(next)
  }

  const swell = (seconds: number): void => {
    const level = { k: 0 }
    const apply = (): void => {
      swellLevel = level.k
      applySettings()
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

  applyMood(MOODS.booth)
  return {
    layer,
    accent,
    decor: decorLayer.layers,
    cells: [...cells, ...decorLayer.cells],
    get mood() {
      return mood
    },
    setMood(name, opts = {}) {
      const to = moodNamed(name)
      const duration = opts.duration ?? 0
      const level = opts.agitation ?? 1
      if (level !== agitation.k) {
        if (duration <= 0) {
          agitation.k = level
          setShake()
          render()
        } else {
          void engine
            .tween(
              agitation,
              { k: level },
              {
                duration,
                easing: easings.inOutCubic,
                onUpdate: () => {
                  setShake()
                  render()
                },
                key: 'agitation',
                signal: scope.signal,
              },
            )
            .catch(ignoreAbort)
        }
      }
      if (to === moodTarget) return 0
      moodTarget = to
      if (duration <= 0) {
        applyMood(to)
        return 0
      }
      const from = mood
      const wait = blendsThroughGrey(from, to) ? duration * GREY_PASSED : 0
      const blend = { k: 0 }
      void engine
        .tween(
          blend,
          { k: 1 },
          {
            duration,
            easing: easings.inOutCubic,
            onUpdate: () => applyMood(blendMood(from, to, blend.k)),
            key: 'mood',
            signal: scope.signal,
          },
        )
        .then(() => applyMood(to))
        .catch(ignoreAbort)
      return wait
    },
    touch(seconds) {
      touching.k = 0
      touching.on = true
      void engine
        .tween(
          touching,
          { k: 1 },
          {
            duration: seconds,
            easing: easings.linear,
            onUpdate: drawDecor,
            key: 'touch',
            signal: scope.signal,
          },
        )
        .then(() => {
          touching.on = false
          drawDecor()
        })
        .catch(ignoreAbort)
    },
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
      decorLayer.destroy()
    },
  }
}
