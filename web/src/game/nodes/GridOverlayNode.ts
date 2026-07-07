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
 * Session-facing surface the overlay reads from once per render frame to
 * compute the warning tint. The overlay stays session-agnostic, session passes
 * accessors, not references, so a `null`-until-ready packet list and a
 * swappable mask still just work.
 */
export interface GridWarnSource {
  /** Current active packet list. Empty array = no warning. */
  activePackets(): readonly PacketNode[]
  /** Country mask for border-inset checks (border-danger sampling). */
  mask(): PacketMask
  /**
   * Gate warn sampling, session sets this false while non-playing so a
   * lingering yellow tint doesn't hang around after `endRound`.
   */
  isPlaying(): boolean
}

export interface GridOverlayOptions {
  /**
   * Country outline mask. Used at construction to point-filter which grid cells
   * land inside the country (kept) vs outside (dropped). The cell-fits-inside
   * test uses `mask.contains(cx, cy, cellHalf)` so coastal cells that would
   * overhang are dropped at load time, no per-frame clip needed.
   */
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
 * Per-cell brightness variance amplitude. Each cell's final alpha is multiplied
 * by `(1 + variance[i])` where `variance[i] ∈ [-VARIANCE_AMP, +VARIANCE_AMP]`.
 * * 10 % up or down. Values are deterministic (index-hashed) so the pattern is
 * stable across reloads within the same grid dimensions. Multiplicative so a
 * `0` target stays `0`.
 */
const VARIANCE_AMP = 0.1

/**
 * Alpha bucket count for the draw-pass batcher. Each cell's final alpha is
 * quantised into `[0, NUM_ALPHA_BUCKETS)` and cells sharing a bucket are drawn
 * in one tight `fillRect` loop with a single `globalAlpha` write. 12 buckets
 * keep the quantisation step (~8 %) imperceptible next to the ±10 % per-cell
 * variance, while collapsing ~500 state-changes to ≤ 12 per pass. Buffers are
 * pre-allocated in the constructor to avoid per-frame GC.
 */
const NUM_ALPHA_BUCKETS = 12

/**
 * A single `SceneNode` that renders a uniform grid of squares across the
 * country's world bounds. Every cell is the same size, the pulse + warn effects
 * light up with visually consistent weight regardless of geography.
 *
 * Per-frame state lives in two parallel `Float32Array` buffers:
 *
 * - `pulseAlpha[]`, recomputed each frame from a small pool of active ripple
 *   pulses. `pulseFrom(worldPos)` fires a wave that spreads outward at
 *   `propagationSpeedWorld`, each cell lights up when the wavefront reaches its
 *   centroid, then falls off. Multiple concurrent pulses combine via `max`.
 * - `warnAlpha[]`, smoothed each frame toward `warnTarget[]`, which the overlay
 *   itself resamples from packet positions inside `onUpdate`. A packet in
 *   danger (close to border or another packet) tints the surrounding grid cells
 *   yellow with linear falloff.
 *
 * Cell geometry is precomputed at construction: iterate the mask's world
 * bounding box on `cellSizeWorld` steps, keep only cells whose four cardinal
 * edge-midpoints pass `mask.contains(cx, cy, cellHalf)`. Coastal cells that
 * would overhang the outline are dropped, no per-frame `ctx.clip` needed,
 * coastline reads as a stair-step of cell edges. Sits on `'above-static'` so
 * alpha changes never invalidate the map's static bake.
 *
 * Draw quantises per-cell alpha into `NUM_ALPHA_BUCKETS` buckets and scatters
 * cell indices into pre-allocated `Uint16Array`s (one per bucket) each frame.
 * Each bucket then renders as a single `globalAlpha` write + tight `fillRect`
 * loop. Canvas 2D's internal batcher stays intact, GPU submissions drop from
 * hundreds per pass to ≤ 12. Buffers are allocated once at construction (no
 * per-frame GC).
 */
export class GridOverlayNode extends SceneNode {
  private readonly cellSize: number
  private readonly cellHalf: number
  /**
   * Country outline mask. Held for the GPU clip path, `draw` wraps its bucketed
   * passes in `gfx.setClipMask(this.mask)` so coastal cells get clipped to the
   * outline instead of overhanging into the water. On Canvas2D the setClipMask
   * is a no-op and the historical overhang remains (fallback, not shipped on
   * the kiosk).
   */
  private readonly mask: BitmapMask
  /** Interleaved (x, y) cell centres, length `2 × count`. */
  private readonly centroids: Float32Array
  private readonly count: number

  private readonly pulseAlpha: Float32Array
  private readonly warnTarget: Float32Array
  private readonly warnAlpha: Float32Array
  /**
   * Deterministic per-cell brightness multiplier in `[1 - VARIANCE_AMP, 1 +
   * VARIANCE_AMP]`. Applied to the final draw alpha so each cell's glow reads
   * slightly dimmer / brighter than its neighbours, breaks up the uniformity of
   * the grid without hiding the wavefront shape.
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

    // Point-filter every cell in the mask's world bounding box. We keep
    // a cell if EITHER its centre or any of its four corners sits inside
    // the outline, the union of samples adds back the coastal ring
    // that a stricter interior-only test drops as visible gaps at the
    // shoreline. Cells that only touch the country by a corner render
    // with some overhang past the coast (up to `cellHalf` world units),
    // but only when lit, the effect reads as glow spilling into the
    // water, not a missing edge. `Float32Array` is fixed-size at
    // construction, build a temporary JS array first, then copy over.
    // This runs once at startup.
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
    // Deterministic per-index hash. Knuth's multiplicative constant
    // mapped through `>>> 0` for unsigned wrap. Same variance pattern
    // every reload, no `Math.random` reproducibility footgun.
    for (let i = 0; i < this.count; i++) {
      const h = ((i * 2654435761) >>> 0) / 4294967296
      // h ∈ [0, 1) → variance factor ∈ [1 - VARIANCE_AMP, 1 + VARIANCE_AMP].
      this.varianceFactor[i] = 1 + (h * 2 - 1) * VARIANCE_AMP
    }

    // Pre-allocated bucket scratch, one Uint16Array per bucket, each
    // sized to `count` (worst case all cells land in the same bucket).
    // Memory footprint: `NUM_ALPHA_BUCKETS × count × 2` bytes, under
    // ~60 KB for ~2500 cells. Zero per-frame allocation.
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

  /**
   * Number of live cells after outline filtering, exposed for debug logs /
   * tests.
   */
  get cellCount(): number {
    return this.count
  }

  /**
   * Session calls this once at construction so `onUpdate` can pull the live
   * packet list + mask without a session import. Passing accessors (not values)
   * means the overlay always sees the freshest data.
   */
  attachWarnSource(source: GridWarnSource): void {
    this.warnSource = source
  }

  /**
   * Fire a ripple from `worldPos`. Overwrites the oldest slot if all
   * `maxConcurrent` are active, game-over animations rarely stack, and dropping
   * the oldest is preferable to allocating more.
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

  /**
   * Zero every alpha buffer and clear every pulse slot. Called from
   * `session.reset()` so an interrupted round doesn't carry stale yellow tints
   * or half-decayed pulses into the next one.
   */
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
    // Clip both passes to the country outline so coastal cells don't
    // spill into the sea. Setter is stack-scoped, `restore` (below)
    // implicitly clears the mask, but we still null it explicitly to
    // match the setter/getter symmetry and to keep the seam legible.
    gfx.setClipMask(this.mask)
    // Warn pass under the pulse, game-over ripple visually wins over
    // any lingering yellow warning.
    this.drawPassBucketed(gfx, this.warnAlpha, TUNING.wahlkreise.warn.color)
    this.drawPassBucketed(gfx, this.pulseAlpha, TUNING.wahlkreise.pulse.color)
    gfx.setClipMask(null)
    gfx.restore()
  }

  /**
   * Draw one alpha buffer as filled cells. The whole pass is TWO tight inner
   * loops, a scatter that bins each lit cell into an alpha bucket, followed by
   * a per-bucket draw that issues ONE `globalAlpha` write plus
   * `bucketCounts[b]` `fillRect` calls. Both loops touch pre-allocated typed
   * arrays only, zero allocation per frame.
   *
   * `variance[i]` is applied inside the scatter so the same cell's warn and
   * pulse contributions share a jitter, visually coherent.
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

    // Draw, one `globalAlpha` write per non-empty bucket, then a tight
    // `fillRect` loop. Canvas 2D's internal batcher stays intact for
    // the run of same-alpha rects.
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
   * Cast rays outward from `(px, py)` in 16 directions and return the closest
   * world position where the country mask flips false, i.e. the nearest wall
   * segment. Writes the result into `out` and returns the hit distance
   * (`Infinity` if no wall found within `maxDistWorld`).
   *
   * Cost per call: 16 directions × ~`maxDistWorld / STEP` raymarch probes. At
   * `maxDistWorld ≈ 54` and `STEP = 3` → ~288 `mask.contains` lookups per
   * packet, or ~1700 for a six-packet round. Each `contains` is O(4) internally
   * , trivial at this rate.
   *
   * The precision within a step is `STEP` world units; we return the midpoint
   * of the last inside-to-outside transition, which is off by at most `STEP /
   * 2`. Fine for a visual glow anchored to the wall.
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
