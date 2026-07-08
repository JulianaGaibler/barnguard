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
 * The "safe zone" at a state's capital, drawn as a 60° cone that opens toward
 * the interior of Germany. Capture is gated by apex proximity AND the packet
 * entering the cone at a valid heading (`isEntryHeadingValid`); the drawn drag
 * no longer has to terminate exactly at the apex. See `PacketBehaviour` and
 * `PathDrawBehaviour` for the mechanic.
 *
 * Layered visuals from back to front:
 *
 * 1. Filled cone wedge with a radial gradient (transparent at apex → `#36FFB9` at
 *    the arc) + a thin `#81FFD3` outline. The whole wedge scales by
 *    `pulseScale` for the breathing grow-in.
 * 2. Small filled white apex dot, the exact capture centre.
 *
 * Not `hitEnabled`, the epicenter is passive; capture is done by packets
 * reading `epicenter.center` / `axisRad` / radii.
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
   * `EpicenterBehaviour`-driven scale (0..1) for the cyan gradient wedge.
   * Tweens 0 → 1 linearly over 2 s, resets to 0, then waits 3 s before the next
   * cycle. Multiplied into the wedge radius so the whole cone breathes.
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

    // Pre-tessellated wedge polygon, ALREADY ROTATED into the node's
    // local frame (apex at (0, 0), arc sweeping symmetrically around
    // `axisRad`). Baking the rotation here means the draw path issues
    // NO runtime `gfx.rotate`, so the apex icon rendered after the
    // wedge inherits only the node's base transform (no leftover
    // rotation state to counteract).
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
   * True when a directed vector `from → apex` lies within the cone's opening
   * (allowing `approachForgivenessRad` of slack beyond `±coneSweep/2`).
   * Currently exported for the future case where a caller wants to test
   * approach angles without recomputing the math; `PathDrawBehaviour` computes
   * it inline to avoid a scratch buffer.
   */
  isApproachAngleValid(fromX: number, fromY: number): boolean {
    const approach = Math.atan2(this.center.y - fromY, this.center.x - fromX)
    const inward = this.axisRad + Math.PI
    const delta = wrapAngle(approach - inward)
    const tol = this.coneSweep * 0.5 + TUNING.epicenter.approachForgivenessRad
    return Math.abs(delta) <= tol
  }

  /**
   * True when a velocity heading (radians) points INTO the cone, i.e. roughly
   * along the inward axis (`axisRad + π`, the direction a packet travelling
   * from the interior toward the apex moves). Allows `approachForgivenessRad`
   * of slack beyond `±coneSweep/2`, the same band as `isApproachAngleValid`.
   * Read by `PacketBehaviour` so a packet entering the safe zone at the correct
   * angle auto-captures without the drawn trail having to terminate at the
   * apex.
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
