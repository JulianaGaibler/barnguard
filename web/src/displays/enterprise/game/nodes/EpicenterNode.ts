import {
  Node2D,
  ShaderQuad,
  definePaintProps,
  parseColor,
  quadShader,
  withAlpha,
  type Canvas,
  type ShaderReflection,
  type Vec2,
} from 'stargazer'
import { TUNING } from '../data/tuning'
import coneDotsWgsl from './coneDots.wgsl?raw'
import coneDotsVert from './coneDots.gen.vert.glsl?raw'
import coneDotsFrag from './coneDots.gen.frag.glsl?raw'
import coneDotsReflect from './coneDots.reflect.json'

const CONE_DOTS_SHADER = quadShader(
  coneDotsVert,
  coneDotsFrag,
  coneDotsWgsl,
  coneDotsReflect as ShaderReflection,
)

/** Bytes in the shader's `Params` block: five vec4s. */
const PARAMS_BYTES = 80

interface EpicenterNodeOptions {
  center: Vec2
  /**
   * A world point the cone should OPEN TOWARD. The axis is computed as
   * `atan2(reference.y − center.y, reference.x − center.x)`. In-game this is
   * Germany's centroid so the cone always faces the interior.
   */
  approachReference: Vec2
  captureRadius?: number
  visualRadius?: number
  coneRadiusWorld?: number
  coneSweepRad?: number
  /**
   * Optional bitmap painted at the apex, the Firefox Enterprise mark in the
   * game. Omitted, a plain white dot is drawn.
   */
  apexIcon?: CanvasImageSource
  /** Rendered size of `apexIcon` in world units (square). Default 20. */
  apexIconSizeWorld?: number
}

/**
 * Safe zone at a state's capital, a 60° cone opening toward the interior.
 * Capture requires apex proximity AND a valid entry heading, not a drag
 * terminating at the apex. Visuals: two fading lines along the cone's edges and
 * a field of purple dots filling it, shrinking away from the apex, with a wave
 * pulsing inward through them, and the Firefox Enterprise mark at the apex.
 * Passive, packets read `center` / `axisRad` / radii directly.
 *
 * The dots and lines are one shader quad. `outerAlpha` is its node's transform
 * alpha and never repaints. `outerScale` and `wavePhase` are shader params, so
 * moving either repaints that single quad.
 */
export class EpicenterNode extends Node2D {
  readonly captureRadius: number
  readonly visualRadius: number
  readonly coneRadius: number
  readonly coneSweep: number
  /**
   * Direction (radians) the cone opens, apex -> approachReference. Packets
   * approaching from within `±(coneSweep/2 + approachForgivenessRad)` of the
   * INWARD axis (`axisRad + π`) are considered valid entries.
   */
  readonly axisRad: number

  #outerAlpha = 1
  #outerScale = 1
  #wavePhase = 0
  readonly #dots: ConeDotsNode

  constructor(opts: EpicenterNodeOptions) {
    super('epicenter')
    this.transform.x = opts.center.x
    this.transform.y = opts.center.y
    this.captureRadius = opts.captureRadius ?? TUNING.epicenter.captureRadius
    this.visualRadius = opts.visualRadius ?? TUNING.epicenter.visualRadius
    this.coneRadius = opts.coneRadiusWorld ?? TUNING.epicenter.coneRadiusWorld
    this.coneSweep = opts.coneSweepRad ?? TUNING.epicenter.coneSweepRad

    // Axis = direction from apex toward the approach reference. Defensive
    // fallback: if the reference is degenerate (right on top of the apex),
    // point straight up so the cone still has a defined orientation.
    const dx = opts.approachReference.x - opts.center.x
    const dy = opts.approachReference.y - opts.center.y
    this.axisRad = dx * dx + dy * dy < 1 ? -Math.PI / 2 : Math.atan2(dy, dx)

    this.#dots = new ConeDotsNode(this.coneRadius, this.coneSweep, this.axisRad)
    this.add(this.#dots)
    this.add(new ApexNode(opts.apexIcon ?? null, opts.apexIconSizeWorld ?? 20))
  }

  /** Overall opacity of the dot field. */
  get outerAlpha(): number {
    return this.#outerAlpha
  }

  set outerAlpha(value: number) {
    this.#outerAlpha = value
    this.#syncVisuals()
  }

  /**
   * Set by `EpicenterBehavior`, grow-in scale applied on show. Multiplied into
   * the cone length the dots reach.
   */
  get outerScale(): number {
    return this.#outerScale
  }

  set outerScale(value: number) {
    this.#outerScale = value
    this.#syncVisuals()
  }

  /**
   * Position of the inward wave, in wavelengths, wrapped to `[0, 1)`.
   * `EpicenterBehavior` advances it every frame.
   */
  get wavePhase(): number {
    return this.#wavePhase
  }

  set wavePhase(value: number) {
    this.#wavePhase = value - Math.floor(value)
    this.#syncVisuals()
  }

  #syncVisuals(): void {
    const dots = this.#dots
    dots.reach = this.#outerScale
    dots.phase = this.#wavePhase
    dots.transform.alpha = this.#outerAlpha
    dots.visible = this.#outerScale > 0.001 && this.#outerAlpha > 0.001
  }

  /** World coord of the safe-zone apex. Read every fixed step by packets. */
  get center(): Vec2 {
    return { x: this.transform.x, y: this.transform.y }
  }

  /**
   * True when `from -> apex` lies within the cone opening (with
   * `approachForgivenessRad` slack beyond `±coneSweep/2`).
   */
  isApproachAngleValid(fromX: number, fromY: number): boolean {
    const approach = Math.atan2(this.center.y - fromY, this.center.x - fromX)
    const inward = this.axisRad + Math.PI
    const delta = wrapAngle(approach - inward)
    const tol = this.coneSweep * 0.5 + TUNING.epicenter.approachForgivenessRad
    return Math.abs(delta) <= tol
  }

  /**
   * True when a heading (radians) points INTO the cone, i.e. within
   * `±(coneSweep/2 + approachForgivenessRad)` of the inward axis.
   * `PacketBehavior` reads this for auto-capture on cone entry.
   */
  isEntryHeadingValid(headingRad: number): boolean {
    const inward = this.axisRad + Math.PI
    const delta = wrapAngle(headingRad - inward)
    const tol = this.coneSweep * 0.5 + TUNING.epicenter.approachForgivenessRad
    return Math.abs(delta) <= tol
  }
}

/**
 * The cone's dot field and edge lines, one shader quad over the cone's bounding
 * square. See `coneDots.wgsl` for the lattice, the wave and the lines. The
 * lines' width follows the screen scale, so a zoom repaints the quad.
 */
class ConeDotsNode extends Node2D {
  /** Fraction of the cone length the dots reach, the intro grow. */
  declare reach: number
  /** Wave phase in `[0, 1)`. */
  declare phase: number
  readonly #radius: number
  readonly #quad: ShaderQuad

  constructor(radius: number, sweep: number, axisRad: number) {
    super('epicenter-dots')
    definePaintProps(this, { reach: 1, phase: 0 })
    this.#radius = radius
    this.#quad = new ShaderQuad({
      shader: CONE_DOTS_SHADER,
      paramsBytes: PARAMS_BYTES,
      label: 'coneDots',
    })
    const cfg = TUNING.epicenter.dots
    const p = this.#quad.params
    p[0] = radius
    p[1] = sweep * 0.5
    p[2] = cfg.pitchWorld
    p[3] = cfg.dotMax
    p[4] = Math.cos(axisRad)
    p[5] = Math.sin(axisRad)
    p[8] = cfg.wavelengthWorld
    p[9] = cfg.waveAmp
    p[10] = cfg.minFrac
    p[11] = cfg.waveSharpness
    const color = parseColor(cfg.color)
    p[12] = color.r
    p[13] = color.g
    p[14] = color.b
    p[15] = cfg.alpha
    p[16] = cfg.innerRadiusWorld
    p[17] = cfg.waveFloor
    p[18] = cfg.ceiling
  }

  override paint(gfx: Canvas): void {
    const p = this.#quad.params
    p[6] = this.reach
    p[7] = this.phase
    p[19] = TUNING.epicenter.dots.edgeLineWidthPx * gfx.screenScale()
    const r = this.#radius
    gfx.drawShaderQuad(this.#quad, -r, -r, r * 2, r * 2)
  }
}

/**
 * The Firefox Enterprise mark at the apex, the exact capture centre. Falls back
 * to a small marker dot when no icon is provided.
 */
class ApexNode extends Node2D {
  readonly #icon: CanvasImageSource | null
  readonly #iconSize: number

  constructor(icon: CanvasImageSource | null, iconSize: number) {
    super('epicenter-apex')
    this.#icon = icon
    this.#iconSize = iconSize
  }

  override paint(gfx: Canvas): void {
    if (this.#icon) {
      const half = this.#iconSize * 0.5
      gfx.drawImage(this.#icon, -half, -half, this.#iconSize, this.#iconSize)
    } else {
      gfx.fillCircle(0, 0, 4, withAlpha('#f8fafc', 1))
    }
  }
}

function wrapAngle(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2
  while (a < -Math.PI) a += Math.PI * 2
  return a
}
