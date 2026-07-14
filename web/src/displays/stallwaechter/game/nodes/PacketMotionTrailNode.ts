import { SceneNode, type Camera, type Gfx2D } from '@src/stargazer'
import { TUNING } from '../data/tuning'
import { withAlpha } from './colorUtils'

export interface PacketMotionTrailOptions {
  /** Ring-buffer capacity, max samples retained. Defaults from `TUNING`. */
  capacity?: number
  /** Half-width of the ribbon at the head (world units). */
  halfWidthWorld?: number
  /**
   * Distance filter threshold (world units), samples closer than this are
   * dropped so a stationary packet doesn't fill the buffer with duplicates.
   */
  minSampleDistWorld?: number
  /** Trail fill colour, opaque near the head, fades to transparent tail. */
  color?: string
}

/**
 * Shooting-star ribbon trail for a moving packet. Owns a distance-filtered ring
 * buffer of recent world-space samples, plus a live head position that
 * `PacketBehaviour` writes every render frame so the ribbon stays glued to the
 * hex despite the sample distance filter and rAF vs fixed-step drift.
 *
 * Rendering builds a closed teardrop path in a single `ctx.fill` per frame:
 * width tapers head → tail with a `pow(1 - t, 0.7)` curve, and the fill is a
 * linear gradient from opaque `color` at the head to fully transparent at the
 * tail. Zero allocations after construction, all scratch state lives in
 * typed-array fields sized to `capacity + 1`.
 *
 * Draw order: this node is expected to render BEFORE the packet (session adds
 * trail to the packet layer FIRST so tree DFS draws it under the hex).
 */
export class PacketMotionTrailNode extends SceneNode {
  readonly capacity: number
  readonly maxHalfWidthWorld: number
  readonly minSampleDistWorldSq: number
  readonly color: string

  /** Interleaved `[x0, y0, x1, y1, …]` ring, sized `capacity × 2`. */
  private readonly buffer: Float32Array
  private head = 0
  private _count = 0
  private lastX = NaN
  private lastY = NaN

  /**
   * Live head, updated per render frame from `PacketBehaviour.onUpdate`.
   * Injected at ordinal 0 of the ribbon so the trail visually glues to the
   * packet's exact position instead of lagging up to `minSampleDist` behind.
   */
  liveHeadX = NaN
  liveHeadY = NaN

  // Scratch buffers reused across every draw, sized `capacity + 1` because
  // the live head, when set, occupies an extra slot ahead of the ring's
  // newest sample.
  private readonly _xs: Float32Array
  private readonly _ys: Float32Array
  private readonly _tx: Float32Array
  private readonly _ty: Float32Array
  private readonly _hw: Float32Array
  /** Interleaved ribbon outline (left edge fwd + right edge back). */
  private readonly _outline: Float32Array

  constructor(opts: PacketMotionTrailOptions = {}) {
    super('packet-motion-trail')
    this.capacity = opts.capacity ?? TUNING.packet.trail.sampleCapacity
    this.maxHalfWidthWorld =
      opts.halfWidthWorld ?? TUNING.packet.trail.halfWidthWorld
    const d = opts.minSampleDistWorld ?? TUNING.packet.trail.minSampleDistWorld
    this.minSampleDistWorldSq = d * d
    this.color = opts.color ?? TUNING.packet.trail.color

    this.buffer = new Float32Array(this.capacity * 2)
    const scratchLen = this.capacity + 1
    this._xs = new Float32Array(scratchLen)
    this._ys = new Float32Array(scratchLen)
    this._tx = new Float32Array(scratchLen)
    this._ty = new Float32Array(scratchLen)
    this._hw = new Float32Array(scratchLen)
    // Outline holds up to 2×scratchLen points (both ribbon edges), 2 floats each.
    this._outline = new Float32Array(scratchLen * 4)
  }

  /** Number of samples currently in the ring buffer (0..capacity). */
  get count(): number {
    return this._count
  }

  /**
   * Push a world-space sample if it's far enough from the previous one. O(1);
   * returns `true` if the sample was accepted.
   */
  sample(x: number, y: number): boolean {
    if (this._count > 0) {
      const dx = x - this.lastX
      const dy = y - this.lastY
      if (dx * dx + dy * dy < this.minSampleDistWorldSq) return false
    }
    const cap = this.capacity
    this.buffer[this.head * 2] = x
    this.buffer[this.head * 2 + 1] = y
    this.head = (this.head + 1) % cap
    if (this._count < cap) this._count++
    this.lastX = x
    this.lastY = y
    return true
  }

  /** Update the live head, cheap; called every render frame. */
  setLiveHead(x: number, y: number): void {
    this.liveHeadX = x
    this.liveHeadY = y
  }

  /** Wipe history (capture, teardown). */
  clear(): void {
    this._count = 0
    this.head = 0
    this.lastX = NaN
    this.lastY = NaN
    this.liveHeadX = NaN
    this.liveHeadY = NaN
  }

  override draw(gfx: Gfx2D, _camera: Camera, _dt: number): void {
    const count = this._count
    if (count === 0) return
    const haveLive =
      Number.isFinite(this.liveHeadX) && Number.isFinite(this.liveHeadY)
    if (count < 2 && !haveLive) return

    // Resolve samples into the scratch arrays, ordinal 0 first (newest).
    const xs = this._xs
    const ys = this._ys
    let n = 0
    // Newest ring sample lives at (head - 1 + capacity) % capacity.
    const cap = this.capacity
    const newestIdx = (this.head - 1 + cap) % cap
    const newestX = this.buffer[newestIdx * 2]
    const newestY = this.buffer[newestIdx * 2 + 1]

    if (haveLive) {
      // Skip the live head if it duplicates the newest ring sample within
      // an epsilon, avoids a zero-length lead segment when the packet has
      // been stationary just long enough to sync.
      const dxLive = this.liveHeadX - newestX
      const dyLive = this.liveHeadY - newestY
      if (dxLive * dxLive + dyLive * dyLive > 1e-4) {
        xs[n] = this.liveHeadX
        ys[n] = this.liveHeadY
        n++
      }
    }
    let idx = newestIdx
    for (let i = 0; i < count; i++) {
      xs[n] = this.buffer[idx * 2]
      ys[n] = this.buffer[idx * 2 + 1]
      idx = (idx - 1 + cap) % cap
      n++
    }
    if (n < 2) return

    // Per-ordinal tangent (unit-normalised, protects against zero-length
    // deltas producing a NaN or bow-tie normal on the next step).
    const tx = this._tx
    const ty = this._ty
    for (let i = 0; i < n - 1; i++) {
      const dx = xs[i] - xs[i + 1]
      const dy = ys[i] - ys[i + 1]
      const lenSq = dx * dx + dy * dy
      const invLen = lenSq > 1e-8 ? 1 / Math.sqrt(lenSq) : 0
      tx[i] = dx * invLen
      ty[i] = dy * invLen
    }
    // Tail tangent copies its neighbour.
    tx[n - 1] = tx[n - 2]
    ty[n - 1] = ty[n - 2]

    // Per-ordinal half-width, teardrop taper.
    const hw = this._hw
    const denom = n - 1
    for (let i = 0; i < n; i++) {
      const t = i / denom
      hw[i] = this.maxHalfWidthWorld * Math.pow(1 - t, 0.7)
    }

    // Build the closed ribbon outline into scratch: left edge head → tail,
    // then right edge tail → head. Perpendicular of (tx, ty) is (-ty, tx).
    const outline = this._outline
    let o = 0
    for (let i = 0; i < n; i++) {
      outline[o++] = xs[i] + -ty[i] * hw[i]
      outline[o++] = ys[i] + tx[i] * hw[i]
    }
    for (let i = n - 1; i >= 0; i--) {
      outline[o++] = xs[i] - -ty[i] * hw[i]
      outline[o++] = ys[i] - tx[i] * hw[i]
    }

    // Linear gradient head → tail. On broadly-curved paths this reads
    // correctly; on hairpin U-turns the gradient may cut across the loop,
    // which is a documented tradeoff (see the plan's "Non-goals" for the
    // segmented-fill fallback if it starts showing).
    gfx.fillPolyLinearGradient(
      outline,
      n * 2,
      xs[0],
      ys[0],
      xs[n - 1],
      ys[n - 1],
      this.color,
      withAlpha(this.color, 0),
    )
  }
}
