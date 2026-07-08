import {
  SceneNode,
  type Camera,
  type Gfx2D,
  type Rect,
  type Vec2,
} from '@src/stargazer'
import { TUNING } from '../data/tuning'
import { withAlpha } from './colorUtils'

/** Number of segments used to tessellate the cone's arc. */
const CONE_ARC_SEGMENTS = 20

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
   * Optional bitmap painted inside the apex disc, the Firefox mark in the main
   * game. Omitted in the tutorial (which has no game assets in scope), in which
   * case only the plain white dot is drawn.
   */
  apexIcon?: CanvasImageSource
  /** Rendered size of `apexIcon` in world units (square). Default 20. */
  apexIconSizeWorld?: number
}

/**
 * Safe zone at a state's capital, a 60° cone opening toward the interior.
 * Capture requires apex proximity AND a valid entry heading, not a drag
 * terminating at the apex. Visuals: gradient wedge + outline (breathing
 * via `pulseScale`) then a white apex dot. Passive, packets read
 * `center` / `axisRad` / radii directly.
 */
export class EpicenterNode extends SceneNode {
  readonly captureRadius: number
  readonly visualRadius: number
  readonly coneRadius: number
  readonly coneSweep: number
  /**
   * Direction (radians) the cone opens, apex → approachReference. Packets
   * approaching from within `±(coneSweep/2 + approachForgivenessRad)` of the
   * INWARD axis (`axisRad + π`) are considered valid entries.
   */
  readonly axisRad: number
  /** Set by `EpicenterBehaviour`, outer alpha for the breathing pulse. */
  outerAlpha = 1
  /**
   * Set by `EpicenterBehaviour`, grow-in scale applied on show. Kept for
   * compatibility with the behaviour; multiplied into the wedge radius.
   */
  outerScale = 1
  /**
   * `EpicenterBehaviour`-driven pulse scale (0..1). Tweens 0 → 1 over 2 s,
   * resets, waits 3 s, repeats. Multiplied into the wedge radius.
   */
  pulseScale = 0
  /** Retained for compatibility with `EpicenterBehaviour`, unused visually. */
  dashRotation = 0

  private readonly _arcPoly: Float32Array
  private readonly apexIcon: CanvasImageSource | null
  private readonly apexIconSize: number

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

    // Pre-tessellated wedge, rotation baked in so the draw path issues no
    // `gfx.rotate` and the apex icon inherits only the node's base transform.
    const half = this.coneSweep * 0.5
    const r = this.coneRadius
    const N = CONE_ARC_SEGMENTS
    const pts = new Float32Array((N + 2) * 2)
    pts[0] = 0
    pts[1] = 0
    for (let i = 0; i <= N; i++) {
      const t = i / N
      const a = this.axisRad - half + this.coneSweep * t
      pts[(i + 1) * 2] = Math.cos(a) * r
      pts[(i + 1) * 2 + 1] = Math.sin(a) * r
    }
    this._arcPoly = pts

    this.apexIcon = opts.apexIcon ?? null
    this.apexIconSize = opts.apexIconSizeWorld ?? 14

    this.debugBounds = boundsFromRadius(this.coneRadius)
  }

  /** World coord of the safe-zone apex. Read every fixed step by packets. */
  get center(): Vec2 {
    return { x: this.transform.x, y: this.transform.y }
  }

  /**
   * True when `from → apex` lies within the cone opening (with
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
   * `PacketBehaviour` reads this for auto-capture on cone entry.
   */
  isEntryHeadingValid(headingRad: number): boolean {
    const inward = this.axisRad + Math.PI
    const delta = wrapAngle(headingRad - inward)
    const tol = this.coneSweep * 0.5 + TUNING.epicenter.approachForgivenessRad
    return Math.abs(delta) <= tol
  }

  override draw(gfx: Gfx2D, camera: Camera): void {
    const alpha = this.transform.alpha
    if (alpha < 0.001) return
    const s = camera.strokeSpaceScale()

    // Base cone wedge, always visible at full radius (with `outerScale`
    // driving the intro grow-in). Fill sits behind the outline. The
    // polygon is already rotated at construction; only the uniform
    // grow-in scale is applied here.
    if (this.outerScale > 0.001) {
      gfx.save()
      gfx.scale(this.outerScale, this.outerScale)

      gfx.setAlpha(alpha * this.outerAlpha * 0.08)
      gfx.fillConvexPoly(this._arcPoly, this._arcPoly.length / 2, '#36FFB9')

      gfx.setAlpha(alpha * this.outerAlpha * 0.7)
      gfx.strokePolyline(this._arcPoly, this._arcPoly.length / 2, {
        color: '#81FFD3',
        width: (1.5 * s) / this.outerScale,
        closed: true,
        join: 'round',
      })

      gfx.restore()
    }

    // Overlay pulse, a brighter wedge that grows from 0 → outerScale and
    // fades out as it expands. Layered on top so it reads as an
    // "energising" sweep across the cone's face.
    if (this.pulseScale > 0.001) {
      const p = this.pulseScale
      const pulseFade = Math.max(0, 1 - p)
      const pulseAlpha = alpha * this.outerAlpha * pulseFade
      if (pulseAlpha > 0.001) {
        const s2 = p * this.outerScale
        gfx.save()
        gfx.scale(s2, s2)
        gfx.setAlpha(pulseAlpha * 0.55)
        gfx.fillConvexPoly(this._arcPoly, this._arcPoly.length / 2, '#81FFD3')
        gfx.restore()
      }
    }

    // Apex disc, the exact capture centre. Sized to host the icon (if
    // supplied) so the mark reads clearly against the cone; falls back
    // to a small marker dot when no icon is provided (e.g. tutorial).
    gfx.setAlpha(alpha)
    if (this.apexIcon) {
      const half = this.apexIconSize * 0.5
      const padding = 3
      gfx.fillCircle(0, 0, half + padding, withAlpha('#f8fafc', 1))
      gfx.drawImage(
        this.apexIcon,
        -half,
        -half,
        this.apexIconSize,
        this.apexIconSize,
      )
    } else {
      gfx.fillCircle(0, 0, 4, withAlpha('#f8fafc', 1))
    }
  }
}

function boundsFromRadius(r: number): Rect {
  return { x: -r, y: -r, width: r * 2, height: r * 2 }
}

function wrapAngle(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2
  while (a < -Math.PI) a += Math.PI * 2
  return a
}
