// Shared batch state every GPU draw program reads or writes: the device
// handle, the transform/state stacks, the texture manager, and which batch is
// currently open. Centralizing it here means a program module never needs a
// back-reference to `GpuGfx` itself.

import type { GfxDevice, Texture, VBuffer } from '../GfxDevice'
import type { GfxBlend } from '../Gfx2D'
import type { BitmapMask } from '../../../assets/BitmapMask'
import type { TextureManager } from './TextureManager'
import type { BatchKind } from './batchLayout'
import { TransformStack, type TransformOut } from './TransformStack'
import { StateStack } from './StateStack'
import type { GpuProgram } from './GpuProgram'

/**
 * Debug render overlays. Only `coloredTri` draws are affected, strokes, SDF,
 * and gradients render normally in every mode.
 *
 * - `'normal'`. Shipping look.
 * - `'polygons'`. Cyan outlines around every fill's outer polygon. Catches
 *   degenerate contours and missing closes. Adds one stroke per fill.
 * - `'overdraw'`. Constant dim red under `lighter` blend. Hot regions accumulate.
 *   Normal blending is unreadable in this mode.
 * - `'batch-color'`. Each coloredTri flush picks a distinct hue via golden-ratio
 *   hue rotation. Hue is per-frame, read grouping patterns not stable colours.
 * - `'clip-mask'`. End-of-frame overlay of the currently-inspected `BitmapMask`
 *   tinted red. Requires `DebugController.setInspectedMask`, otherwise renders
 *   nothing.
 *
 * @category Debug
 */
export type DebugRenderMode =
  'normal' | 'polygons' | 'overdraw' | 'batch-color' | 'clip-mask'

/** Per-frame stats surfaced to the debug HUD. */
export interface GpuGfxStats {
  drawCalls: number
  programSwitches: number
  textureBinds: number
  blendSwitches: number
  overflowWarns: number
  sdfInstances: number
  strokeInstances: number
  /**
   * Effective (post-clamp) MSAA sample count on the offscreen render target.
   * `1` = off. Set once per FBO alloc, carried here for the HUD.
   */
  msaaSamples: number
}

/** Batch key fields a program's flush needs to bind before drawing. */
export interface BatchKey {
  texture?: Texture | null
  lut?: Texture | null
  clipMask?: BitmapMask | null
}

export class GpuBatchContext {
  device: GfxDevice
  readonly stats: GpuGfxStats

  /** Column-major 3×3 for `u_proj`. Updated once per frame. */
  readonly projMat = new Float32Array(9)

  readonly txStack = new TransformStack(32)
  readonly stateStack = new StateStack(32)
  readonly txOut: TransformOut = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }

  /**
   * Every texture the GPU backend uses: atlas, per-source, gradient LUTs, clip
   * masks.
   */
  textureManager!: TextureManager

  /** Unit-quad template shared by every instanced program. */
  unitQuadBuffer!: VBuffer

  curSlot = 0

  /**
   * Global (not stack-scoped): the debug HUD is the sole caller and wants every
   * draw affected until toggled off. Only `coloredTri`'s flush reads it.
   */
  curDebugMode: DebugRenderMode = 'normal'
  /** Flush counter for `'batch-color'` hue picking. Reset each frame. */
  debugBatchCounter = 0

  // Current batch. A change to any of these forces a flush.
  curBatch: BatchKind = 'none'
  curTexture: Texture | null = null
  /** Second bound texture (LUT) for the `maskedGradient` batch. */
  curLut: Texture | null = null
  curBlend: GfxBlend = 'source-over'
  curClipMask: BitmapMask | null = null

  readonly #programs = new Map<BatchKind, GpuProgram>()

  constructor(device: GfxDevice, stats: GpuGfxStats) {
    this.device = device
    this.stats = stats
  }

  registerProgram(program: GpuProgram): void {
    this.#programs.set(program.kind, program)
  }

  /**
   * Flush-on-state-change guard, the generalization of the seven programs'
   * near-identical `startXxx` methods. `key` carries only the fields this
   * batch's identity depends on, e.g. `stroke`/`sdf` pass none (blend-only),
   * `texturedQuad`/`textQuad`/`gradientRadial` pass `texture`, `maskedGradient`
   * passes `texture` + `lut`, `coloredTri` passes `clipMask`.
   */
  beginBatch(kind: BatchKind, key: BatchKey = {}): void {
    const wantBlend = this.stateStack.getBlend()
    const sameBatch = this.curBatch === kind
    const sameBlend = this.curBlend === wantBlend
    const sameTexture = !('texture' in key) || this.curTexture === key.texture
    const sameLut = !('lut' in key) || this.curLut === key.lut
    const sameMask = !('clipMask' in key) || this.curClipMask === key.clipMask
    if (sameBatch && sameBlend && sameTexture && sameLut && sameMask) return
    this.flushActive()
    this.curBatch = kind
    this.curBlend = wantBlend
    if ('texture' in key) this.curTexture = key.texture ?? null
    if ('lut' in key) this.curLut = key.lut ?? null
    if ('clipMask' in key) this.curClipMask = key.clipMask ?? null
  }

  /** Dispatch to the active program's `flush`, then clear the batch marker. */
  flushActive(): void {
    if (this.curBatch === 'none') return
    const blendMode = this.curBlend === 'lighter' ? 'lighter' : 'source-over'
    this.device.setBlend(blendMode)
    this.stats.blendSwitches++
    this.#programs.get(this.curBatch)?.flush(this)
    this.curBatch = 'none'
  }

  /** Called once per frame, after the ring slot has advanced. */
  resetSlot(slot: number): void {
    for (const program of this.#programs.values()) program.resetSlot(slot)
  }

  /** Called once per frame, alongside `resetSlot`. */
  resetBatchMarkers(): void {
    this.curBatch = 'none'
    this.curTexture = null
    this.curLut = null
    this.curClipMask = null
    this.debugBatchCounter = 0
  }
}
