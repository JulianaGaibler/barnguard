import {
  DataTexture,
  Node2D,
  ShaderQuad,
  parseColor,
  quadShader,
  type BitmapMask,
  type CameraView2D,
  type Gfx2D,
  type Rect,
  type ShaderReflection,
  type Vec2,
} from '@src/stargazer'
import type { PacketNode } from './PacketNode'
import type { PacketMask } from '../behaviors/PacketBehavior'
import { TUNING } from '../data/tuning'
import dotGridWgsl from './dotGrid.wgsl?raw'
import dotGridVert from './dotGrid.gen.vert.glsl?raw'
import dotGridFrag from './dotGrid.gen.frag.glsl?raw'
import dotGridReflect from './dotGrid.reflect.json'

const DOT_GRID_SHADER = quadShader(
  dotGridVert,
  dotGridFrag,
  dotGridWgsl,
  dotGridReflect as ShaderReflection,
)

/** Bytes in the shader's `Params` block: three vec4s. */
const PARAMS_BYTES = 48

/**
 * Session-facing accessors the overlay pulls each render frame. Accessors (not
 * values) so a swappable mask and a `null`-until-ready packet list work.
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
  /** World rectangle the grid covers, laid out from its top left corner. */
  bounds: Rect
  /**
   * Keeps only the cells whose centre falls inside the outline. `null` keeps
   * every cell in `bounds`.
   */
  mask: BitmapMask | null
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

/** Values below this count as unlit. */
const MIN_LIT_VALUE = 0.02

/**
 * Per-cell size variance. A cell's value is scaled by `(1 + variance[i])` with
 * `variance ∈ [-VARIANCE_AMP, +VARIANCE_AMP]`. Deterministic index hash so the
 * pattern is stable across reloads. Multiplicative so `0` stays `0`.
 */
const VARIANCE_AMP = 0.1

/**
 * A grid of dots whose size shows how lit each cell is: nothing at 0, a dot a
 * fixed fraction of the cell at 1, never touching its neighbours. The whole
 * grid is one shader quad, so a frame costs a single draw however many cells
 * are lit. Sits on the dynamic layer, above the map and under the packets. It
 * stays off `'above-static'`, where the quad draws alongside the promoted
 * region fills and the WebGPU backend floods their inset glows solid white.
 *
 * Per-frame state:
 *
 * - `pulseValue[]`, event-driven ripples. `pulseFrom(worldPos)` fires a wave
 *   spreading at `propagationSpeedWorld`, each cell lights when the wavefront
 *   reaches its centroid. Concurrent pulses combine via `max`.
 * - `warnValue[]`, smoothed toward `warnTarget[]` resampled from packet positions
 *   each `onUpdate`. Dots with linear falloff around packets in danger.
 *
 * Both packed into a `cols × rows` texture (R warn, G pulse) the shader reads.
 * Cells are precomputed at construction on `cellSizeWorld` steps across
 * `bounds`, keeping the ones whose centre is inside the mask when there is one.
 * Nothing draws while every value is zero.
 */
export class GridOverlayNode extends Node2D {
  readonly #cellSize: number
  readonly #bounds: Rect
  readonly #cols: number
  readonly #rows: number
  /** Interleaved (x, y) cell centres, length `2 × count`. */
  readonly #centroids: Float32Array
  /** Byte offset into the texture of each kept cell. */
  readonly #texel: Uint32Array
  readonly #count: number

  readonly #pulseValue: Float32Array
  readonly #warnTarget: Float32Array
  readonly #warnValue: Float32Array
  /**
   * Per-cell size multiplier in `[1 - VARIANCE_AMP, 1 + VARIANCE_AMP]`. Breaks
   * up grid uniformity without hiding the wavefront.
   */
  readonly #varianceFactor: Float32Array
  readonly #pulses: PulseSlot[]

  readonly #cells: DataTexture
  readonly #quad: ShaderQuad
  /** Whether the texture holds only zeros, so the draw can be skipped. */
  #textureClear = true

  #elapsed = 0
  #warnSource: GridWarnSource | null = null
  /** Scratch for the `findNearestWallPoint` raymarch, reused each frame. */
  readonly #wallScratch: Vec2 = { x: 0, y: 0 }

  constructor(opts: GridOverlayOptions) {
    super('grid-overlay')
    this.renderLayer = 'dynamic'

    const step = opts.cellSizeWorld
    this.#cellSize = step
    this.#bounds = { ...opts.bounds }
    const cols = Math.max(1, Math.ceil(opts.bounds.width / step))
    const rows = Math.max(1, Math.ceil(opts.bounds.height / step))
    this.#cols = cols
    this.#rows = rows

    const mask = opts.mask
    const scratch: number[] = []
    const texels: number[] = []
    for (let r = 0; r < rows; r++) {
      const cy = opts.bounds.y + (r + 0.5) * step
      for (let c = 0; c < cols; c++) {
        const cx = opts.bounds.x + (c + 0.5) * step
        if (mask && !mask.contains(cx, cy, 0)) continue
        scratch.push(cx, cy)
        texels.push((r * cols + c) * 4)
      }
    }
    this.#centroids = new Float32Array(scratch)
    this.#texel = new Uint32Array(texels)
    this.#count = texels.length

    this.#pulseValue = new Float32Array(this.#count)
    this.#warnTarget = new Float32Array(this.#count)
    this.#warnValue = new Float32Array(this.#count)
    this.#varianceFactor = new Float32Array(this.#count)
    // Deterministic per-index hash (Knuth's multiplicative constant). Same
    // variance pattern every reload, no `Math.random` footgun.
    for (let i = 0; i < this.#count; i++) {
      const h = ((i * 2654435761) >>> 0) / 4294967296
      // h ∈ [0, 1) -> variance factor ∈ [1 - VARIANCE_AMP, 1 + VARIANCE_AMP].
      this.#varianceFactor[i] = 1 + (h * 2 - 1) * VARIANCE_AMP
    }

    this.#cells = new DataTexture(cols, rows, { filter: 'nearest' })
    this.#quad = new ShaderQuad({
      shader: DOT_GRID_SHADER,
      paramsBytes: PARAMS_BYTES,
      textures: [this.#cells],
      label: 'dotGrid',
    })
    const p = this.#quad.params
    p[0] = cols
    p[1] = rows
    p[2] = TUNING.wahlkreise.grid.dotSize
    const warn = parseColor(TUNING.wahlkreise.warn.color)
    p[4] = warn.r
    p[5] = warn.g
    p[6] = warn.b
    p[7] = TUNING.wahlkreise.warn.dotAlpha
    const pulse = parseColor(TUNING.wahlkreise.pulse.color)
    p[8] = pulse.r
    p[9] = pulse.g
    p[10] = pulse.b
    p[11] = TUNING.wahlkreise.pulse.dotAlpha

    const maxConcurrent = TUNING.wahlkreise.pulse.maxConcurrent
    this.#pulses = []
    for (let i = 0; i < maxConcurrent; i++) {
      this.#pulses.push({
        active: false,
        startTime: 0,
        amplitude: 0,
        maxWavefrontDelay: 0,
        wavefrontDelay: new Float32Array(this.#count),
      })
    }
  }

  /**
   * Fade the dots out over this many cells at the grid's four edges, so the
   * grid has no visible rim. `0` draws every dot full size to the edge.
   */
  setFeather(cells: number): void {
    this.#quad.params[3] = Math.max(0, cells)
  }

  /** Live cell count after outline filtering. */
  get cellCount(): number {
    return this.#count
  }

  /**
   * Session wires accessors so `onUpdate` sees freshest packet list / mask
   * without a session import.
   */
  attachWarnSource(source: GridWarnSource): void {
    this.#warnSource = source
  }

  /**
   * Fire a ripple from `worldPos`. Overwrites the oldest slot if all
   * `maxConcurrent` are active.
   */
  pulseFrom(worldPos: Vec2, amplitudeOverride?: number): void {
    const slot = this.#pickPulseSlot()
    const cfg = TUNING.wahlkreise.pulse
    slot.active = true
    slot.startTime = this.#elapsed
    slot.amplitude = amplitudeOverride ?? cfg.peakScale
    const invSpeed = 1 / cfg.propagationSpeedWorld
    let maxDelay = 0
    const n = this.#count
    for (let i = 0; i < n; i++) {
      const dx = this.#centroids[i * 2] - worldPos.x
      const dy = this.#centroids[i * 2 + 1] - worldPos.y
      const delay = Math.sqrt(dx * dx + dy * dy) * invSpeed
      slot.wavefrontDelay[i] = delay
      if (delay > maxDelay) maxDelay = delay
    }
    slot.maxWavefrontDelay = maxDelay
  }

  /** Test/dev only: read a pulse value (the buffer is private state). */
  _pulseValueAt(i: number): number {
    return this.#pulseValue[i]
  }

  /** Test/dev only: read a cell's packed texel as `[warn, pulse]` bytes. */
  _texelAt(i: number): readonly [number, number] {
    const at = this.#texel[i]
    return [this.#cells.data[at], this.#cells.data[at + 1]]
  }

  /** Clear all value buffers and pulse slots. Called from `session.reset()`. */
  reset(): void {
    this.#elapsed = 0
    this.#pulseValue.fill(0)
    this.#warnTarget.fill(0)
    this.#warnValue.fill(0)
    for (const slot of this.#pulses) {
      slot.active = false
      slot.startTime = 0
      slot.amplitude = 0
      slot.maxWavefrontDelay = 0
    }
    this.#pack()
  }

  override onUpdate(dt: number): void {
    if (dt <= 0) return
    this.#elapsed += dt
    this.#updatePulses()
    this.#updateWarn(dt)
    this.#pack()
  }

  override draw(gfx: Gfx2D, _camera: CameraView2D): void {
    if (this.#count === 0 || this.#textureClear) return
    gfx.drawShaderQuad(
      this.#quad,
      this.#bounds.x,
      this.#bounds.y,
      this.#cols * this.#cellSize,
      this.#rows * this.#cellSize,
    )
  }

  /**
   * Write the cells' values into the texture (R warn, G pulse), scaled by each
   * cell's variance. Marks the texture dirty only when something is lit or the
   * last frame left something lit that has now gone out.
   */
  #pack(): void {
    const data = this.#cells.data
    const texel = this.#texel
    const variance = this.#varianceFactor
    const warn = this.#warnValue
    const pulse = this.#pulseValue
    let lit = false
    for (let i = 0; i < this.#count; i++) {
      const at = texel[i]
      const w =
        warn[i] >= MIN_LIT_VALUE ? Math.min(1, warn[i] * variance[i]) : 0
      const p =
        pulse[i] >= MIN_LIT_VALUE ? Math.min(1, pulse[i] * variance[i]) : 0
      if (w > 0 || p > 0) lit = true
      data[at] = w * 255
      data[at + 1] = p * 255
    }
    if (!lit && this.#textureClear) return
    this.#textureClear = !lit
    this.#cells.markDirty()
  }

  #pickPulseSlot(): PulseSlot {
    // Prefer an inactive slot, else evict the earliest start time.
    let oldest = this.#pulses[0]
    for (const slot of this.#pulses) {
      if (!slot.active) return slot
      if (slot.startTime < oldest.startTime) oldest = slot
    }
    return oldest
  }

  /**
   * Nearest wall point from `(px, py)`, cast in 16 directions. Writes `out` and
   * returns hit distance (`Infinity` if no wall within `maxDistWorld`).
   * Precision is `STEP / 2` world units, fine for a visual glow anchor.
   */
  #findNearestWallPoint(
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

  #updatePulses(): void {
    const cfg = TUNING.wahlkreise.pulse
    const rise = cfg.riseSec
    const fall = cfg.fallSec
    const totalLife = rise + fall
    const n = this.#count
    const pulseValue = this.#pulseValue
    pulseValue.fill(0)
    for (const slot of this.#pulses) {
      if (!slot.active) continue
      // Expire once every cell has finished its pulse envelope.
      if (this.#elapsed - slot.startTime > slot.maxWavefrontDelay + totalLife) {
        slot.active = false
        continue
      }
      const amp = slot.amplitude
      const startTime = slot.startTime
      const delay = slot.wavefrontDelay
      const elapsed = this.#elapsed
      for (let i = 0; i < n; i++) {
        const localT = elapsed - startTime - delay[i]
        if (localT < 0 || localT > totalLife) continue
        // Triangular envelope: 0 -> amp over `rise`, then amp -> 0 over `fall`.
        const value =
          localT < rise
            ? (localT / rise) * amp
            : (1 - (localT - rise) / fall) * amp
        if (value > pulseValue[i]) pulseValue[i] = value
      }
    }
  }

  #updateWarn(dt: number): void {
    const warnTarget = this.#warnTarget
    const warnValue = this.#warnValue
    warnTarget.fill(0)

    const src = this.#warnSource
    if (src && src.isPlaying()) {
      const cfg = TUNING.wahlkreise.warn
      const packets = src.activePackets()
      const mask = src.mask()
      const spread = cfg.spreadRadiusWorld
      const spreadSq = spread * spread
      const invSpread = 1 / spread
      const peakScale = cfg.peakScale
      const pairR = cfg.pairRadiusWorld
      const pairRsq = pairR * pairR
      const invPairR = 1 / pairR
      const centroids = this.#centroids
      const n = this.#count

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
          this.#findNearestWallPoint(
            bx,
            by,
            mask,
            cfg.insetFarWorld + 6,
            this.#wallScratch,
          )
          const wx = this.#wallScratch.x
          const wy = this.#wallScratch.y
          for (let i = 0; i < n; i++) {
            const dx = centroids[i * 2] - wx
            const dy = centroids[i * 2 + 1] - wy
            const d2 = dx * dx + dy * dy
            if (d2 >= spreadSq) continue
            const d = Math.sqrt(d2)
            const contribution = borderDanger * (1 - d * invSpread) * peakScale
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
          const contribution = pairDanger * (1 - d * invSpread) * peakScale
          if (contribution > warnTarget[i]) warnTarget[i] = contribution
        }
      }
    }

    // Exponential low-pass toward the target. Allocation-free.
    const rate = TUNING.wahlkreise.warn.smoothingRatePerSec
    const step = 1 - Math.exp(-rate * dt)
    const n = this.#count
    for (let i = 0; i < n; i++) {
      warnValue[i] += (warnTarget[i] - warnValue[i]) * step
    }
  }
}
