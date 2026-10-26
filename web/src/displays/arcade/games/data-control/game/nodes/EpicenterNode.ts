import { Node2D, withAlpha, type Canvas, type Vec2 } from 'stargazer'
import { TUNING } from '../data/tuning'

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

/** Which layer of the cone a {@link ConeWedgeNode} paints. */
type WedgeKind = 'base' | 'pulse'

/**
 * One layer of the epicenter's cone. The parent turns it with scale and alpha
 * on its transform, so the breathing and the pulse repaint nothing.
 */
class ConeWedgeNode extends Node2D {
  readonly #poly: Float32Array
  readonly #kind: WedgeKind

  constructor(kind: WedgeKind, poly: Float32Array) {
    super(`epicenter-${kind}`)
    this.#kind = kind
    this.#poly = poly
    this.visible = false
  }

  override paint(canvas: Canvas): void {
    const n = this.#poly.length / 2
    if (this.#kind === 'pulse') {
      canvas.setAlpha(0.55)
      canvas.fillConvexPoly(this.#poly, n, '#7C93FF')
      return
    }
    canvas.setAlpha(0.08)
    canvas.fillConvexPoly(this.#poly, n, '#2B4CFF')
    canvas.setAlpha(0.7)
    canvas.strokePolyline(this.#poly, n, {
      color: '#7C93FF',
      width: 1.5 * canvas.screenScale(),
      closed: true,
      join: 'round',
    })
  }
}

/**
 * Safe zone at a state's capital, a 60° cone opening toward the interior.
 * Capture requires apex proximity AND a valid entry heading, not a drag
 * terminating at the apex. Visuals: gradient wedge + outline (breathing via
 * `pulseScale`) then a white apex dot. Passive, packets read `center` /
 * `axisRad` / radii directly.
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
  /** Set by `EpicenterBehavior`, outer alpha for the breathing pulse. */
  get outerAlpha(): number {
    return this.#outerAlpha
  }
  set outerAlpha(v: number) {
    this.#outerAlpha = v
    this.#syncWedges()
  }
  /**
   * Set by `EpicenterBehavior`, grow-in scale applied on show. Multiplied into
   * the wedge radius.
   */
  get outerScale(): number {
    return this.#outerScale
  }
  set outerScale(v: number) {
    this.#outerScale = v
    this.#syncWedges()
  }
  /**
   * `EpicenterBehavior`-driven pulse scale (0..1). Tweens 0 -> 1 over 4 s,
   * resets, waits 3 s, repeats. Multiplied into the wedge radius.
   */
  get pulseScale(): number {
    return this.#pulseScale
  }
  set pulseScale(v: number) {
    this.#pulseScale = v
    this.#syncWedges()
  }
  /** Retained for compatibility with `EpicenterBehavior`, unused visually. */
  dashRotation = 0

  #outerAlpha = 1
  #outerScale = 1
  #pulseScale = 0
  readonly #base: ConeWedgeNode
  readonly #pulse: ConeWedgeNode
  readonly #apexIcon: CanvasImageSource | null
  readonly #apexIconSize: number

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

    // Pre-tessellated wedge with the rotation baked in.
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
    this.#base = new ConeWedgeNode('base', pts)
    this.#pulse = new ConeWedgeNode('pulse', pts)
    this.add(this.#base)
    this.add(this.#pulse)
    this.#syncWedges()

    this.#apexIcon = opts.apexIcon ?? null
    this.#apexIconSize = opts.apexIconSizeWorld ?? 14
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

  /**
   * Writes the wedges' transforms. The base wedge grows in with `outerScale`
   * and breathes with `outerAlpha`. The pulse wedge grows from the apex to the
   * grown cone and fades as it expands.
   */
  #syncWedges(): void {
    const base = this.#base
    const pulse = this.#pulse
    const shown = this.#outerScale > 0.001
    base.visible = shown
    if (shown) {
      base.transform.scaleX = this.#outerScale
      base.transform.scaleY = this.#outerScale
      base.transform.alpha = this.#outerAlpha
    }
    const p = this.#pulseScale
    const pulseAlpha = this.#outerAlpha * Math.max(0, 1 - p)
    const pulsing = p > 0.001 && pulseAlpha > 0.001
    pulse.visible = pulsing
    if (pulsing) {
      const s = p * this.#outerScale
      pulse.transform.scaleX = s
      pulse.transform.scaleY = s
      pulse.transform.alpha = pulseAlpha
    }
  }

  /**
   * The apex disc, the exact capture centre. Sized to host the icon (if
   * supplied) so the mark reads clearly against the cone. Falls back to a small
   * marker dot when no icon is provided (e.g. tutorial).
   */
  override paint(canvas: Canvas): void {
    if (this.#apexIcon) {
      const half = this.#apexIconSize * 0.5
      const padding = 3
      canvas.fillCircle(0, 0, half + padding, withAlpha('#f8fafc', 1))
      canvas.drawImage(
        this.#apexIcon,
        -half,
        -half,
        this.#apexIconSize,
        this.#apexIconSize,
      )
    } else {
      canvas.fillCircle(0, 0, 4, withAlpha('#f8fafc', 1))
    }
  }
}

function wrapAngle(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2
  while (a < -Math.PI) a += Math.PI * 2
  return a
}
