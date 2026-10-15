import {
  GfxPath,
  Node2D,
  definePaintProps,
  type Canvas,
  type GfxGradientStop,
  type GfxLinearGradient,
} from '@src/stargazer'
import { TUNING } from '../data/tuning'

export interface PacketMotionTrailOptions {
  /** Ring-buffer capacity, max samples retained. Defaults from `TUNING`. */
  capacity?: number
  /** Radius of the halo hex at the head (world units). */
  glowRadiusWorld?: number
  /**
   * Distance filter threshold (world units), samples closer than this are
   * dropped so a stationary packet doesn't fill the buffer with duplicates.
   */
  minSampleDistWorld?: number
}

/**
 * Comet tail for a moving packet. Owns a distance-filtered ring buffer of
 * recent world-space samples, plus a live head position that `PacketBehavior`
 * writes every render frame so the tail stays glued to the hex despite the
 * sample distance filter and rAF vs fixed-step drift. The tail repaints
 * whenever a sample is accepted or the live head moves, so a tail behind a
 * moving packet repaints every frame and a resting one never.
 *
 * The outline starts as a halo hex around the packet, turned with the packet so
 * their edges stay parallel: the front of the hex wraps the head, and its two
 * side edges carry on into the tail, which tapers with a `pow(1 - t, 0.7)`
 * curve to a point. The first stretch of the tail does not trace the recent
 * path exactly. It is a chain of the samples' segments whose bend per unit
 * length is capped, tight at the head and loosening quickly, so the tail leaves
 * the packet straight and keeps its form there, then follows the path.
 *
 * It is filled with a head-to-tail orange ramp and outlined with a red ramp
 * that fades out, both from `TUNING.packet.trail`. No allocations after
 * construction: the path is cleared and refilled, and scratch state lives in
 * typed arrays sized to `capacity + 1`.
 *
 * Draw order: this node is expected to render BEFORE the packet (session adds
 * trail to the packet layer FIRST so tree DFS draws it under the hex).
 */
export class PacketMotionTrailNode extends Node2D {
  readonly capacity: number
  readonly glowRadiusWorld: number
  readonly minSampleDistWorldSq: number

  /** Interleaved `[x0, y0, x1, y1, …]` ring, sized `capacity × 2`. */
  readonly #buffer: Float32Array
  #head = 0
  #_count = 0
  #lastX = NaN
  #lastY = NaN

  /**
   * Live head, updated per render frame from `PacketBehavior.onUpdate`.
   * Injected at ordinal 0 of the tail so it visually glues to the packet's
   * exact position instead of lagging up to `minSampleDist` behind.
   */
  declare liveHeadX: number
  declare liveHeadY: number
  /**
   * The packet's rotation, which the halo hex and the tail's start follow.
   * `NaN` takes the heading from the samples instead.
   */
  declare liveHeadRotation: number

  // Scratch buffers reused across every paint, sized `capacity + 1` because
  // the live head, when set, occupies an extra slot ahead of the ring's
  // newest sample.
  readonly #_xs: Float32Array
  readonly #_ys: Float32Array
  /** The chain's points, its backward unit directions, and arc lengths. */
  readonly #_cx: Float32Array
  readonly #_cy: Float32Array
  readonly #_dx: Float32Array
  readonly #_dy: Float32Array
  readonly #_s: Float32Array
  readonly #path = new GfxPath()
  // Paints are reused, the canvas copies them when it records a draw.
  readonly #fill: GfxLinearGradient
  readonly #stroke: GfxLinearGradient

  constructor(opts: PacketMotionTrailOptions = {}) {
    super('packet-motion-trail')
    definePaintProps(this, {
      liveHeadX: NaN,
      liveHeadY: NaN,
      liveHeadRotation: NaN,
    })
    const cfg = TUNING.packet.trail
    this.capacity = opts.capacity ?? cfg.sampleCapacity
    this.glowRadiusWorld =
      opts.glowRadiusWorld ?? TUNING.packet.radius * cfg.glowScale
    const d = opts.minSampleDistWorld ?? cfg.minSampleDistWorld
    this.minSampleDistWorldSq = d * d

    this.#buffer = new Float32Array(this.capacity * 2)
    const scratchLen = this.capacity + 1
    this.#_xs = new Float32Array(scratchLen)
    this.#_ys = new Float32Array(scratchLen)
    this.#_cx = new Float32Array(scratchLen)
    this.#_cy = new Float32Array(scratchLen)
    this.#_dx = new Float32Array(scratchLen)
    this.#_dy = new Float32Array(scratchLen)
    this.#_s = new Float32Array(scratchLen)
    this.#fill = linear(cfg.fillStops)
    this.#stroke = linear(cfg.strokeStops)
  }

  /** Number of samples currently in the ring buffer (0..capacity). */
  get count(): number {
    return this.#_count
  }

  /**
   * Push a world-space sample if it's far enough from the previous one. O(1),
   * returns `true` if the sample was accepted.
   */
  sample(x: number, y: number): boolean {
    if (this.#_count > 0) {
      const dx = x - this.#lastX
      const dy = y - this.#lastY
      if (dx * dx + dy * dy < this.minSampleDistWorldSq) return false
    }
    const cap = this.capacity
    this.#buffer[this.#head * 2] = x
    this.#buffer[this.#head * 2 + 1] = y
    this.#head = (this.#head + 1) % cap
    if (this.#_count < cap) this.#_count++
    this.#lastX = x
    this.#lastY = y
    this.markNeedsPaint()
    return true
  }

  /**
   * Update the live head, and the packet's rotation when it has one (see
   * `liveHeadRotation`). A head that has not moved or turned repaints nothing.
   */
  setLiveHead(x: number, y: number, rotation = NaN): void {
    this.liveHeadX = x
    this.liveHeadY = y
    this.liveHeadRotation = rotation
  }

  /** Wipe history (capture, teardown). */
  clear(): void {
    this.#_count = 0
    this.#head = 0
    this.#lastX = NaN
    this.#lastY = NaN
    this.liveHeadX = NaN
    this.liveHeadY = NaN
    this.liveHeadRotation = NaN
    this.markNeedsPaint()
  }

  override paint(gfx: Canvas): void {
    const count = this.#_count
    if (count === 0) return
    const haveLive =
      Number.isFinite(this.liveHeadX) && Number.isFinite(this.liveHeadY)
    if (count < 2 && !haveLive) return

    // Resolve samples into the scratch arrays, ordinal 0 first (newest).
    const xs = this.#_xs
    const ys = this.#_ys
    let n = 0
    // Newest ring sample lives at (head - 1 + capacity) % capacity.
    const cap = this.capacity
    const newestIdx = (this.#head - 1 + cap) % cap
    const newestX = this.#buffer[newestIdx * 2]
    const newestY = this.#buffer[newestIdx * 2 + 1]

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
      xs[n] = this.#buffer[idx * 2]
      ys[n] = this.#buffer[idx * 2 + 1]
      idx = (idx - 1 + cap) % cap
      n++
    }
    if (n < 2) return

    // Heading at the head. `PacketNode`'s hex points a vertex along it, so a
    // rotation of `heading + π/2` lines the halo up with the packet.
    const hx = xs[0]
    const hy = ys[0]
    let fx: number
    let fy: number
    if (Number.isFinite(this.liveHeadRotation)) {
      const heading = this.liveHeadRotation - Math.PI / 2
      fx = Math.cos(heading)
      fy = Math.sin(heading)
    } else {
      const dx = hx - xs[1]
      const dy = hy - ys[1]
      const len = Math.hypot(dx, dy)
      if (len < 1e-6) return
      fx = dx / len
      fy = dy / len
    }

    // Chain: each segment keeps its sample spacing but turns toward its
    // sample by at most `segment length × curvature`. The curvature grows
    // with the square of the distance along the tail up to `stiffLengthWorld`,
    // and past it the cap is loose enough that the chain follows the samples.
    const cfg = TUNING.packet.trail
    const cx = this.#_cx
    const cy = this.#_cy
    const ddx = this.#_dx
    const ddy = this.#_dy
    const s = this.#_s
    cx[0] = hx
    cy[0] = hy
    ddx[0] = -fx
    ddy[0] = -fy
    s[0] = 0
    for (let i = 1; i < n; i++) {
      const seg = Math.hypot(xs[i] - xs[i - 1], ys[i] - ys[i - 1])
      const px = ddx[i - 1]
      const py = ddy[i - 1]
      const wx = xs[i] - cx[i - 1]
      const wy = ys[i] - cy[i - 1]
      const u = Math.min(1, s[i - 1] / cfg.stiffLengthWorld)
      const curvature =
        cfg.bendHeadRadPerWorld +
        (cfg.bendTipRadPerWorld - cfg.bendHeadRadPerWorld) * u * u
      const limit = seg * curvature
      let turn = Math.atan2(px * wy - py * wx, px * wx + py * wy)
      if (turn > limit) turn = limit
      else if (turn < -limit) turn = -limit
      const c = Math.cos(turn)
      const sn = Math.sin(turn)
      ddx[i] = px * c - py * sn
      ddy[i] = px * sn + py * c
      cx[i] = cx[i - 1] + ddx[i] * seg
      cy[i] = cy[i - 1] + ddy[i] * seg
      s[i] = s[i - 1] + seg
    }

    // The halo's side edges end half its radius behind the head, where the
    // tail takes over. A tail shorter than the halo is stretched to a stub.
    const g = this.glowRadiusWorld
    const start = g * 0.5
    const last = n - 1
    if (s[last] < g) {
      cx[last] = hx - fx * g
      cy[last] = hy - fy * g
      ddx[last] = -fx
      ddy[last] = -fy
      s[last] = g
    }
    const total = s[last]
    const headHalfWidth = g * SIN_60

    // Closed outline: the halo's front from one side edge round to the
    // other, back along that side of the tail to the tip, then forward along
    // the first side. With forward `(fx, fy)` the halo walk ends on the
    // `(-fy, fx)` side, which for a backward direction `(dx, dy)` is
    // `(dy, -dx)`.
    const path = this.#path
    path.clear()
    for (let k = 0; k < HALO_ANGLES.length; k++) {
      const a = HALO_ANGLES[k]
      const ca = Math.cos(a) * g
      const sa = Math.sin(a) * g
      const x = hx + fx * ca - fy * sa
      const y = hy + fy * ca + fx * sa
      if (k === 0) path.moveTo(x, y)
      else path.lineTo(x, y)
    }
    for (let i = 1; i <= last; i++) {
      if (s[i] <= start) continue
      const hw = halfWidth(headHalfWidth, s[i], start, total)
      path.lineTo(cx[i] + ddy[i] * hw, cy[i] - ddx[i] * hw)
    }
    for (let i = last - 1; i >= 1; i--) {
      if (s[i] <= start) continue
      const hw = halfWidth(headHalfWidth, s[i], start, total)
      path.lineTo(cx[i] - ddy[i] * hw, cy[i] + ddx[i] * hw)
    }
    path.close()

    // Linear ramps head -> tail. On broadly-curved paths this reads
    // correctly. On hairpin U-turns the gradient may cut across the loop,
    // a tradeoff accepted over per-segment fills.
    const fill = this.#fill
    const stroke = this.#stroke
    fill.x0 = stroke.x0 = hx
    fill.y0 = stroke.y0 = hy
    fill.x1 = stroke.x1 = cx[last]
    fill.y1 = stroke.y1 = cy[last]
    gfx.fillPath(path, fill)
    gfx.strokePath(path, {
      color: stroke,
      width: TUNING.packet.trail.strokeWidthWorld,
      join: 'round',
    })
  }

  override destroy(): void {
    super.destroy()
    this.#path.release()
  }
}

const SIN_60 = Math.sin(Math.PI / 3)

/**
 * The halo vertices drawn as its front, relative to the heading, from one side
 * edge's back end round to the other's. The tail continues from the two at
 * `±2π/3`.
 */
const HALO_ANGLES = [
  (-2 * Math.PI) / 3,
  -Math.PI / 3,
  0,
  Math.PI / 3,
  (2 * Math.PI) / 3,
]

/** Tail half-width at arc length `s`: full at `start`, zero at `total`. */
function halfWidth(
  head: number,
  s: number,
  start: number,
  total: number,
): number {
  const t = Math.min(1, (s - start) / Math.max(total - start, 1e-6))
  return head * Math.pow(1 - t, 0.7)
}

function linear(stops: readonly GfxGradientStop[]): GfxLinearGradient {
  return { kind: 'linear', x0: 0, y0: 0, x1: 1, y1: 0, stops }
}
