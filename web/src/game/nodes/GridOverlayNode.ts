import {
  SceneNode,
  type BitmapMask,
  type Camera,
  type Gfx2D,
  type Vec2,
} from '@src/stargazer'
import type { PacketNode } from './PacketNode'
import type { PacketMask } from '../behaviours/PacketBehaviour'
import { TUNING } from '../data/tuning'

/**
 * Session-facing accessors the overlay pulls each render frame. Accessors
 * (not values) so a swappable mask and a `null`-until-ready packet list work.
 */
export interface GridWarnSource {
  /** Active packets. Empty = no warning. */
  activePackets(): readonly PacketNode[]
  /** Country mask for border-inset checks. */
  mask(): PacketMask
  /** False while non-playing so warn tints clear cleanly on `endRound`. */
  isPlaying(): boolean
}

export interface GridOverlayOptions {
  /** Country outline. Used at construction to filter cells outside Germany. */
  mask: BitmapMask
  /** Cell edge length in world units. */
  cellSizeWorld: number
}

interface PulseSlot {
  active: boolean
  startTime: number
  amplitude: number
  maxWavefrontDelay: number
  wavefrontDelay: Float32Array
}

const MIN_DRAW_ALPHA = 0.02

/**
 * Per-cell brightness variance. Final alpha *= `(1 + variance[i])` with
 * `variance ∈ [-VARIANCE_AMP, +VARIANCE_AMP]`. Deterministic index hash so
 * the pattern is stable across reloads. Multiplicative so `0` stays `0`.
 */
const VARIANCE_AMP = 0.1

/**
 * Alpha buckets for draw batching. Each cell's alpha quantises into a bucket,
 * every non-empty bucket is one `globalAlpha` write + `fillRect` loop. 12
 * keeps the quantisation step (~8 %) below the ±10 % variance so it's
 * imperceptible, while collapsing ~500 state changes to ≤ 12 per pass.
 */
const NUM_ALPHA_BUCKETS = 12

/**
 * Uniform grid of squares clipped to the country outline. Sits on
 * `'above-static'` so alpha changes don't invalidate the map's static bake.
 *
 * Per-frame state:
 * - `pulseAlpha[]`, event-driven ripples. `pulseFrom(worldPos)` fires a wave
 *   spreading at `propagationSpeedWorld`, each cell lights when the wavefront
 *   reaches its centroid. Concurrent pulses combine via `max`.
 * - `warnAlpha[]`, smoothed toward `warnTarget[]` resampled from packet
 *   positions each `onUpdate`. Yellow tint with linear falloff around packets
 *   in danger.
 *
 * Cells precomputed at construction by iterating the mask's bounding box on
 * `cellSizeWorld` steps and keeping centre-or-corner hits.
 */
export class GridOverlayNode extends SceneNode {
  private readonly cellSize: number
  private readonly cellHalf: number
  /**
   * Country outline. `draw` wraps its passes in `gfx.setClipMask(this.mask)`
   * so coastal cells clip to the outline on GPU. Canvas2D `setClipMask` is a
   * no-op, coastal cells overhang there (fallback path, not the kiosk).
   */
  private readonly mask: BitmapMask
  /** Interleaved (x, y) cell centres, length `2 × count`. */
  private readonly centroids: Float32Array
  private readonly count: number

  private readonly pulseAlpha: Float32Array
  private readonly warnTarget: Float32Array
  private readonly warnAlpha: Float32Array
  /**
   * Per-cell brightness multiplier in `[1 - VARIANCE_AMP, 1 + VARIANCE_AMP]`.
   * Breaks up grid uniformity without hiding the wavefront.
   */
  private readonly varianceFactor: Float32Array
  private readonly pulses: PulseSlot[]

  /** Per-bucket cell-index scratch, pre-allocated. */
  private readonly buckets: Uint16Array[]
  /** Live count per bucket for the current pass, reset each pass. */
  private readonly bucketCounts: Uint16Array

  private elapsed = 0
  private warnSource: GridWarnSource | null = null
  /** Scratch for the `findNearestWallPoint` raymarch, reused each frame. */
  private readonly wallScratch: Vec2 = { x: 0, y: 0 }

  constructor(opts: GridOverlayOptions) {
    super('grid-overlay')
    this.renderLayer = 'above-static'

    this.mask = opts.mask
    const step = opts.cellSizeWorld
    this.cellSize = step
    this.cellHalf = step * 0.5

    // Keep any cell whose centre OR any corner sits inside the outline.
    // Interior-only would drop the coastal ring as visible gaps, corner
    // hits render as glow spilling into the water when lit, no missing
    // edge. Build in a growable array then copy into the fixed Float32Array.
    const rect = opts.mask.worldRect
    const cols = Math.ceil(rect.width / step)
    const rows = Math.ceil(rect.height / step)
    const scratch: number[] = []
    const mask = opts.mask
    const half = this.cellHalf
    for (let r = 0; r < rows; r++) {
      const cy = rect.y + (r + 0.5) * step
      for (let c = 0; c < cols; c++) {
        const cx = rect.x + (c + 0.5) * step
        if (
          mask.contains(cx, cy, 0) ||
          mask.contains(cx - half, cy - half, 0) ||
          mask.contains(cx + half, cy - half, 0) ||
          mask.contains(cx - half, cy + half, 0) ||
          mask.contains(cx + half, cy + half, 0)
        ) {
          scratch.push(cx, cy)
        }
      }
    }
    this.centroids = new Float32Array(scratch)
    this.count = scratch.length / 2

    this.pulseAlpha = new Float32Array(this.count)
    this.warnTarget = new Float32Array(this.count)
    this.warnAlpha = new Float32Array(this.count)
    this.varianceFactor = new Float32Array(this.count)
    // Deterministic per-index hash (Knuth's multiplicative constant). Same
    // variance pattern every reload, no `Math.random` footgun.
    for (let i = 0; i < this.count; i++) {
      const h = ((i * 2654435761) >>> 0) / 4294967296
      // h ∈ [0, 1) → variance factor ∈ [1 - VARIANCE_AMP, 1 + VARIANCE_AMP].
      this.varianceFactor[i] = 1 + (h * 2 - 1) * VARIANCE_AMP
    }

    // One Uint16Array per bucket, worst-case sized to `count`. ~60 KB for
    // ~2500 cells. Zero per-frame allocation.
    this.buckets = new Array(NUM_ALPHA_BUCKETS)
    for (let b = 0; b < NUM_ALPHA_BUCKETS; b++) {
      this.buckets[b] = new Uint16Array(this.count)
    }
    this.bucketCounts = new Uint16Array(NUM_ALPHA_BUCKETS)

    const maxConcurrent = TUNING.wahlkreise.pulse.maxConcurrent
    this.pulses = []
    for (let i = 0; i < maxConcurrent; i++) {
      this.pulses.push({
        active: false,
        startTime: 0,
        amplitude: 0,
        maxWavefrontDelay: 0,
        wavefrontDelay: new Float32Array(this.count),
      })
    }
  }

  /** Live cell count after outline filtering. */
  get cellCount(): number {
    return this.count
  }

  /**
   * Session wires accessors so `onUpdate` sees freshest packet list / mask
   * without a session import.
   */
  attachWarnSource(source: GridWarnSource): void {
    this.warnSource = source
  }

  /**
   * Fire a ripple from `worldPos`. Overwrites the oldest slot if all
   * `maxConcurrent` are active.
   */
  pulseFrom(worldPos: Vec2, amplitudeOverride?: number): void {
    const slot = this.pickPulseSlot()
    const cfg = TUNING.wahlkreise.pulse
    slot.active = true
    slot.startTime = this.elapsed
    slot.amplitude = amplitudeOverride ?? cfg.peakAlpha
    const invSpeed = 1 / cfg.propagationSpeedWorld
    let maxDelay = 0
    const n = this.count
    for (let i = 0; i < n; i++) {
      const dx = this.centroids[i * 2] - worldPos.x
      const dy = this.centroids[i * 2 + 1] - worldPos.y
      const delay = Math.sqrt(dx * dx + dy * dy) * invSpeed
      slot.wavefrontDelay[i] = delay
      if (delay > maxDelay) maxDelay = delay
    }
    slot.maxWavefrontDelay = maxDelay
  }

  /** Clear all alpha buffers and pulse slots. Called from `session.reset()`. */
  reset(): void {
    this.elapsed = 0
    this.pulseAlpha.fill(0)
    this.warnTarget.fill(0)
    this.warnAlpha.fill(0)
    for (const slot of this.pulses) {
      slot.active = false
      slot.startTime = 0
      slot.amplitude = 0
      slot.maxWavefrontDelay = 0
    }
  }

  override onUpdate(dt: number): void {
    if (dt <= 0) return
    this.elapsed += dt
    this.updatePulses()
    this.updateWarn(dt)
  }

  override draw(gfx: Gfx2D, _camera: Camera): void {
    if (this.count === 0) return
    gfx.save()
    // Clip both passes so coastal cells don't spill into the sea.
    gfx.setClipMask(this.mask)
    // Warn under pulse, game-over ripple wins visually over lingering warn.
    this.drawPassBucketed(gfx, this.warnAlpha, TUNING.wahlkreise.warn.color)
    this.drawPassBucketed(gfx, this.pulseAlpha, TUNING.wahlkreise.pulse.color)
    gfx.setClipMask(null)
    gfx.restore()
  }

  /**
   * Draw one alpha buffer as filled cells. Scatter bins lit cells into alpha
   * buckets, per-bucket loop issues one `globalAlpha` + tight `fillRect`s.
   * `variance[i]` applied in the scatter so warn and pulse share jitter.
   */
  private drawPassBucketed(gfx: Gfx2D, src: Float32Array, color: string): void {
    const n = this.count
    const variance = this.varianceFactor
    const bucketCounts = this.bucketCounts
    const buckets = this.buckets

    bucketCounts.fill(0)

    // Scatter, one entry per lit cell into its alpha bucket.
    for (let i = 0; i < n; i++) {
      const raw = src[i]
      if (raw < MIN_DRAW_ALPHA) continue
      let a = raw * variance[i]
      if (a > 1) a = 1
      else if (a < 0) a = 0
      if (a < MIN_DRAW_ALPHA) continue
      let b = (a * NUM_ALPHA_BUCKETS) | 0
      if (b >= NUM_ALPHA_BUCKETS) b = NUM_ALPHA_BUCKETS - 1
      buckets[b][bucketCounts[b]++] = i
    }

    // One `globalAlpha` per non-empty bucket, tight `fillRect` loop.
    const centroids = this.centroids
    const size = this.cellSize
    const half = this.cellHalf
    const invBuckets = 1 / NUM_ALPHA_BUCKETS
    for (let b = 0; b < NUM_ALPHA_BUCKETS; b++) {
      const bcount = bucketCounts[b]
      if (bcount === 0) continue
      // Bucket midpoint alpha, quantisation step is `1 / NUM_ALPHA_BUCKETS`.
      gfx.setAlpha((b + 0.5) * invBuckets)
      const bucket = buckets[b]
      for (let j = 0; j < bcount; j++) {
        const i = bucket[j]
        gfx.fillRect(
          centroids[i * 2] - half,
          centroids[i * 2 + 1] - half,
          size,
          size,
          color,
        )
      }
    }
  }

  private pickPulseSlot(): PulseSlot {
    // Prefer an inactive slot; else evict the earliest start time.
    let oldest = this.pulses[0]
    for (const slot of this.pulses) {
      if (!slot.active) return slot
      if (slot.startTime < oldest.startTime) oldest = slot
    }
    return oldest
  }

  /**
   * Nearest wall point from `(px, py)`, cast in 16 directions. Writes `out`
   * and returns hit distance (`Infinity` if no wall within `maxDistWorld`).
   * Precision is `STEP / 2` world units, fine for a visual glow anchor.
   */
  private findNearestWallPoint(
    px: number,
    py: number,
    mask: PacketMask,
    maxDistWorld: number,
    out: Vec2,
  ): number {
    const DIRECTIONS = 16
    const STEP = 3
    const TWO_PI = Math.PI * 2
    let bestDist = Infinity
    let bestX = px
    let bestY = py
    for (let i = 0; i < DIRECTIONS; i++) {
      const angle = (i / DIRECTIONS) * TWO_PI
      const dx = Math.cos(angle)
      const dy = Math.sin(angle)
      let d = 0
      while (d < maxDistWorld) {
        d += STEP
        const wx = px + dx * d
        const wy = py + dy * d
        if (!mask.contains(wx, wy, 0)) {
          const hitDist = d - STEP * 0.5
          if (hitDist < bestDist) {
            bestDist = hitDist
            bestX = px + dx * hitDist
            bestY = py + dy * hitDist
          }
          break
        }
      }
    }
    out.x = bestX
    out.y = bestY
    return bestDist
  }

  private updatePulses(): void {
    const cfg = TUNING.wahlkreise.pulse
    const rise = cfg.riseSec
    const fall = cfg.fallSec
    const totalLife = rise + fall
    const n = this.count
    const pulseAlpha = this.pulseAlpha
    pulseAlpha.fill(0)
    for (const slot of this.pulses) {
      if (!slot.active) continue
      // Expire once every cell has finished its pulse envelope.
      if (this.elapsed - slot.startTime > slot.maxWavefrontDelay + totalLife) {
        slot.active = false
        continue
      }
      const amp = slot.amplitude
      const startTime = slot.startTime
      const delay = slot.wavefrontDelay
      const elapsed = this.elapsed
      for (let i = 0; i < n; i++) {
        const localT = elapsed - startTime - delay[i]
        if (localT < 0 || localT > totalLife) continue
        // Triangular envelope: 0 → amp over `rise`, then amp → 0 over `fall`.
        const value =
          localT < rise
            ? (localT / rise) * amp
            : (1 - (localT - rise) / fall) * amp
        if (value > pulseAlpha[i]) pulseAlpha[i] = value
      }
    }
  }

  private updateWarn(dt: number): void {
    const warnTarget = this.warnTarget
    const warnAlpha = this.warnAlpha
    warnTarget.fill(0)

    const src = this.warnSource
    if (src && src.isPlaying()) {
      const cfg = TUNING.wahlkreise.warn
      const packets = src.activePackets()
      const mask = src.mask()
      const spread = cfg.spreadRadiusWorld
      const spreadSq = spread * spread
      const invSpread = 1 / spread
      const peakAlpha = cfg.peakAlpha
      const pairR = cfg.pairRadiusWorld
      const pairRsq = pairR * pairR
      const invPairR = 1 / pairR
      const centroids = this.centroids
      const n = this.count

      for (let pi = 0; pi < packets.length; pi++) {
        const p = packets[pi]
        const bx = p.transform.x
        const by = p.transform.y

        // Border proximity: two-level via mask insets. Only warn when
        // the packet is still INSIDE the country, a `'lost'` packet
        // that has already drifted past the coast shouldn't paint a
        // nonsensical wall highlight.
        let borderDanger = 0
        if (mask.contains(bx, by, 0)) {
          if (!mask.contains(bx, by, cfg.insetFarWorld)) borderDanger = 0.5
          if (!mask.contains(bx, by, cfg.insetNearWorld)) borderDanger = 1
        }
        if (borderDanger > 0) {
          // Highlight the NEAREST WALL POINT rather than the area around
          // the packet, reads as "here's the wall you're heading into".
          this.findNearestWallPoint(
            bx,
            by,
            mask,
            cfg.insetFarWorld + 6,
            this.wallScratch,
          )
          const wx = this.wallScratch.x
          const wy = this.wallScratch.y
          for (let i = 0; i < n; i++) {
            const dx = centroids[i * 2] - wx
            const dy = centroids[i * 2 + 1] - wy
            const d2 = dx * dx + dy * dy
            if (d2 >= spreadSq) continue
            const d = Math.sqrt(d2)
            const contribution = borderDanger * (1 - d * invSpread) * peakAlpha
            if (contribution > warnTarget[i]) warnTarget[i] = contribution
          }
        }

        // Pair proximity: nearest other packet's danger contribution.
        // Broadcast centred at THIS packet's position (no wall involved).
        let pairDanger = 0
        for (let pj = 0; pj < packets.length; pj++) {
          if (pj === pi) continue
          const q = packets[pj]
          const dx = q.transform.x - bx
          const dy = q.transform.y - by
          const d2 = dx * dx + dy * dy
          if (d2 < pairRsq) {
            const d = Math.sqrt(d2)
            const contribution = 1 - d * invPairR
            if (contribution > pairDanger) pairDanger = contribution
          }
        }

        if (pairDanger <= 0) continue
        // Broadcast pair danger centered on the packet.
        for (let i = 0; i < n; i++) {
          const dx = centroids[i * 2] - bx
          const dy = centroids[i * 2 + 1] - by
          const d2 = dx * dx + dy * dy
          if (d2 >= spreadSq) continue
          const d = Math.sqrt(d2)
          const contribution = pairDanger * (1 - d * invSpread) * peakAlpha
          if (contribution > warnTarget[i]) warnTarget[i] = contribution
        }
      }
    }

    // Exponential low-pass toward the target. Allocation-free.
    const rate = TUNING.wahlkreise.warn.smoothingRatePerSec
    const step = 1 - Math.exp(-rate * dt)
    const n = this.count
    for (let i = 0; i < n; i++) {
      warnAlpha[i] += (warnTarget[i] - warnAlpha[i]) * step
    }
  }
}
