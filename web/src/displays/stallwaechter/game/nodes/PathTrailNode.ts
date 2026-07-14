import {
  PolylineNode,
  type Camera,
  type Gfx2D,
  type Vec2,
} from '@src/stargazer'
import { TUNING } from '../data/tuning'

/**
 * Player-drawn routing line. Decouples the packet's guidance queue from the
 * visible stroke. `markConsumed` advances an index instead of `dropHead`
 * so faded points survive briefly. `onUpdate` drops them lazily once
 * `age > fadeSec`. `draw` walks segments, ahead-of-packet full alpha,
 * behind-packet fades by consume age.
 */
export class PathTrailNode extends PolylineNode {
  /**
   * Engine-time (seconds) at which each point index was reached by the packet.
   * `-1` = not yet consumed. Grown in parallel with the polyline's point
   * buffer.
   */
  private pointConsumedAt: Float32Array
  /** Count of points the packet has already passed (0..pointCount). */
  private consumedCount = 0
  /** Cached engine time, refreshed each `onUpdate`. */
  private nowSec = 0

  private readonly _scratchA: Vec2 = { x: 0, y: 0 }
  private readonly _scratchB: Vec2 = { x: 0, y: 0 }
  private readonly _scratchC: Vec2 = { x: 0, y: 0 }

  constructor() {
    super({
      capacity: 256,
      // Base colour is fully opaque; per-segment alpha is applied via
      // `ctx.globalAlpha` in `draw`.
      strokeStyle: '#fdf6e3',
      lineWidth: 1,
      lineJoin: 'round',
      lineCap: 'round',
      smoothing: 'none',
    })
    this.pointConsumedAt = new Float32Array(this.capacity)
    this.pointConsumedAt.fill(-1)
  }

  /** Next-target index for the packet's steering. */
  get nextTargetIndex(): number {
    return this.consumedCount
  }

  /**
   * Called by `PacketBehaviour` when it passes the current target point.
   * Advances the consumed index and stamps the time so the segment behind
   * starts fading. No-op when the queue is already drained.
   */
  markConsumed(nowSec: number): void {
    if (this.consumedCount >= this.pointCount) return
    this.pointConsumedAt[this.consumedCount] = nowSec
    this.consumedCount++
  }

  override push(x: number, y: number): void {
    const wasCap = this.capacity
    super.push(x, y)
    if (this.capacity > wasCap) {
      // Polyline's Float32Array doubled, mirror the parallel array.
      const next = new Float32Array(this.capacity)
      next.fill(-1)
      next.set(this.pointConsumedAt)
      this.pointConsumedAt = next
    }
    this.pointConsumedAt[this.pointCount - 1] = -1

    // Corner smoothing on unconsumed tail points. Bounded window so
    // settled interior corners don't keep drifting. Consumed points are
    // skipped so the packet never sees a waypoint move under it.
    this.smoothTail()
  }

  private smoothTail(): void {
    const n = this.pointCount
    if (n < 3) return
    const consumedCount = this.consumedCount
    // Pull each interior point a small fraction (α = 0.09375) toward the
    // midpoint of its neighbours. Compounds across pushes to a subtle
    // ease without erasing hand-drawn character.
    const windowStart = Math.max(consumedCount + 1, n - 8)
    const windowEnd = n - 1 // exclusive, last point stays anchored to the raw finger
    if (windowStart >= windowEnd) return
    const alpha = 0.09375
    const halfAlpha = alpha * 0.5
    const centreWeight = 1 - alpha
    const pA = this._scratchA
    const pB = this._scratchB
    const pC = this._scratchC
    for (let i = windowStart; i < windowEnd; i++) {
      this.pointAt(i - 1, pA)
      this.pointAt(i, pB)
      this.pointAt(i + 1, pC)
      const nx = centreWeight * pB.x + halfAlpha * (pA.x + pC.x)
      const ny = centreWeight * pB.y + halfAlpha * (pA.y + pC.y)
      this.setPoint(i, nx, ny)
    }
  }

  override clear(): void {
    super.clear()
    this.pointConsumedAt.fill(-1)
    this.consumedCount = 0
  }

  override dropHead(count: number): void {
    const before = this.pointCount
    super.dropHead(count)
    const dropped = before - this.pointCount
    if (dropped > 0) {
      this.pointConsumedAt.copyWithin(0, dropped)
      this.pointConsumedAt.fill(-1, this.pointCount)
      this.consumedCount = Math.max(0, this.consumedCount - dropped)
    }
  }

  override onUpdate(_dt: number): void {
    // Refresh from the engine's shared clock so the fade animation stays in
    // sync with tweens and other time-based visuals.
    const engine = this.scene?.engine
    if (!engine) return
    this.nowSec = engine.ticker.time
    // Trim any head points that have finished fading, keeps the point
    // buffer bounded for long drags.
    const fade = TUNING.path.fadeSec
    while (
      this.consumedCount > 0 &&
      this.pointCount > 0 &&
      this.pointConsumedAt[0] >= 0 &&
      this.nowSec - this.pointConsumedAt[0] > fade
    ) {
      this.dropHead(1)
    }
  }

  override draw(gfx: Gfx2D, camera: Camera, _dt: number): void {
    const n = this.pointCount
    if (n < 2) return
    const fade = TUNING.path.fadeSec
    const now = this.nowSec
    // Stroke width + dash in CSS px, scaled by `strokeSpaceScale` to stay
    // visually constant across zoom. World-space stroking bypasses this.
    const s = this.strokeSpace === 'world' ? 1 : camera.strokeSpaceScale()
    // Dashed pattern shared across every sub-segment; only alpha varies.
    const style = {
      color: this.strokeStyle,
      width: this.lineWidth * s,
      join: this.lineJoin,
      cap: this.lineCap,
      dash: [6 * s, 4 * s],
    }
    gfx.save()
    const pA = this._scratchA
    const pB = this._scratchB
    const pC = this._scratchC

    if (n === 2) {
      // Degenerate case, just a straight line between the two points.
      this.pointAt(0, pA)
      this.pointAt(1, pB)
      const alpha = this.alphaFor(0, now, fade)
      if (alpha > 0) {
        gfx.setAlpha(alpha)
        gfx.strokeLine(pA.x, pA.y, pB.x, pB.y, style)
      }
      gfx.restore()
      return
    }

    // Quadratic-Bézier midpoint smoothing, each waypoint P_i is the CONTROL
    // point of a quadratic curve anchored at the midpoints to its neighbours.
    // Per-sub-segment alpha still works because each is its own stroke.
    //
    // Sub-segment k's alpha is driven by `pointConsumedAt[k]`:
    //   - k = 0        (P_0 → mid(P_0,P_1))       : fades when packet passes P_0
    //   - 1 ≤ k ≤ n-2  (mid(P_{k-1},P_k) → mid(P_k,P_{k+1}) via P_k) : fades when P_k is consumed
    //   - k = n-1      (mid(P_{n-2},P_{n-1}) → P_{n-1}) : fades when P_{n-1} is consumed

    // First sub-segment.
    this.pointAt(0, pA)
    this.pointAt(1, pB)
    {
      const mx = (pA.x + pB.x) * 0.5
      const my = (pA.y + pB.y) * 0.5
      const alpha = this.alphaFor(0, now, fade)
      if (alpha > 0) {
        gfx.setAlpha(alpha)
        gfx.strokeLine(pA.x, pA.y, mx, my, style)
      }
    }

    // Middle quadratic sub-segments.
    for (let i = 1; i < n - 1; i++) {
      this.pointAt(i - 1, pA)
      this.pointAt(i, pB)
      this.pointAt(i + 1, pC)
      const startX = (pA.x + pB.x) * 0.5
      const startY = (pA.y + pB.y) * 0.5
      const endX = (pB.x + pC.x) * 0.5
      const endY = (pB.y + pC.y) * 0.5
      const alpha = this.alphaFor(i, now, fade)
      if (alpha <= 0) continue
      gfx.setAlpha(alpha)
      gfx.strokeQuadratic(startX, startY, pB.x, pB.y, endX, endY, style)
    }

    // Last sub-segment.
    this.pointAt(n - 2, pA)
    this.pointAt(n - 1, pB)
    {
      const mx = (pA.x + pB.x) * 0.5
      const my = (pA.y + pB.y) * 0.5
      const alpha = this.alphaFor(n - 1, now, fade)
      if (alpha > 0) {
        gfx.setAlpha(alpha)
        gfx.strokeLine(mx, my, pB.x, pB.y, style)
      }
    }

    gfx.restore()
  }

  private alphaFor(pointIdx: number, now: number, fade: number): number {
    const at = this.pointConsumedAt[pointIdx]
    if (at < 0) return 1
    const age = now - at
    return age >= fade ? 0 : 1 - age / fade
  }
}
