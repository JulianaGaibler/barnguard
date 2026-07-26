// Double-buffered CPU→GPU vertex/instance streaming for one draw program.

import type { GfxDevice, VBuffer } from './GfxDevice'
import { RING_SIZE } from './batchLayout'

/**
 * Double-buffered CPU staging + GPU VBOs. Dual views (float, uint) alias one
 * shared ArrayBuffer. The cursor is APPEND-ONLY within a frame: records
 * accumulate, `takeRun` carves the appended range for one draw-run, and the
 * whole written range is uploaded once (`upload`) before the command list
 * replays. `reset` clears it once per frame. Overflow forces a mid-frame submit
 * (see `GpuBatchContext.overflowSubmit`), which orphans the GPU buffer and
 * restarts the cursor via `resetAfterSubmit`.
 */
export class RingStream {
  readonly buffers: VBuffer[] = new Array(RING_SIZE)
  readonly cpuBuffer: ArrayBuffer
  readonly floatView: Float32Array
  readonly uintView: Uint32Array
  readonly pendingWords: Uint32Array = new Uint32Array(RING_SIZE)
  readonly pendingVerts: Uint32Array = new Uint32Array(RING_SIZE)
  readonly pendingInstances: Uint32Array = new Uint32Array(RING_SIZE)
  /** Word offset where the current (not-yet-recorded) draw-run began. */
  readonly lastRunWords: Uint32Array = new Uint32Array(RING_SIZE)
  readonly byteSize: number
  readonly wordSize: number
  readonly recordStride: number
  readonly label: string
  #warned = false

  constructor(
    device: GfxDevice,
    byteSize: number,
    recordStride: number,
    label = 'stream',
  ) {
    this.byteSize = byteSize
    this.wordSize = byteSize / 4
    this.recordStride = recordStride
    this.label = label
    this.cpuBuffer = new ArrayBuffer(byteSize)
    this.floatView = new Float32Array(this.cpuBuffer)
    this.uintView = new Uint32Array(this.cpuBuffer)
    for (let i = 0; i < RING_SIZE; i++) {
      this.buffers[i] = device.createVertexBuffer(byteSize)
    }
  }

  /** Clear the slot for a fresh frame (called once per frame from `beginFrame`). */
  reset(slot: number): void {
    this.pendingWords[slot] = 0
    this.pendingVerts[slot] = 0
    this.pendingInstances[slot] = 0
    this.lastRunWords[slot] = 0
    this.#warned = false
  }

  /**
   * Restart the cursor after a mid-frame overflow submit. Unlike `reset`, keeps
   * the overflow-warn latch so a single frame warns at most once. The caller
   * must have already `orphanBuffer`ed the GPU buffer so the just-submitted
   * data the GPU is still reading isn't overwritten.
   */
  resetAfterSubmit(slot: number): void {
    this.pendingWords[slot] = 0
    this.pendingVerts[slot] = 0
    this.pendingInstances[slot] = 0
    this.lastRunWords[slot] = 0
  }

  /**
   * Carve the appended-but-unrecorded range `[lastRunWords, pendingWords)` for
   * one draw-run, advancing the marker. `null` when nothing was appended since
   * the previous run.
   */
  takeRun(slot: number): { startWord: number; endWord: number } | null {
    const start = this.lastRunWords[slot]
    const end = this.pendingWords[slot]
    if (end === start) return null
    this.lastRunWords[slot] = end
    return { startWord: start, endWord: end }
  }

  /** Upload the whole written range `[0, pendingWords)` once, before replay. */
  upload(device: GfxDevice, slot: number): void {
    const words = this.pendingWords[slot]
    if (words === 0) return
    device.updateBufferSubData(
      this.buffers[slot],
      0,
      this.floatView,
      0,
      words * 4,
    )
  }

  /**
   * Reserve `wordsNeeded` for a vertex batch, returns the word offset in the
   * CPU buffer or `-1` on overflow.
   */
  reserve(slot: number, wordsNeeded: number, vertCount: number): number {
    const cur = this.pendingWords[slot]
    if (cur + wordsNeeded > this.wordSize) {
      this.#warnOverflow(vertCount)
      return -1
    }
    void vertCount // used only in commit()
    return cur
  }

  commit(slot: number, wordsAdded: number, vertCount: number): void {
    this.pendingWords[slot] += wordsAdded
    this.pendingVerts[slot] += vertCount
  }

  /** Reserve one instance record; return the word offset. */
  reserveInstance(slot: number): number {
    const cur = this.pendingWords[slot]
    const wordsNeeded = this.recordStride / 4
    if (cur + wordsNeeded > this.wordSize) {
      this.#warnOverflow(1)
      return -1
    }
    return cur
  }

  commitInstance(slot: number): void {
    this.pendingWords[slot] += this.recordStride / 4
    this.pendingInstances[slot] += 1
  }

  #warnOverflow(dropped: number): void {
    if (this.#warned) return
    this.#warned = true
    const cap = Math.floor(this.byteSize / this.recordStride)
    console.warn(
      `GpuGfx: '${this.label}' buffer overflow, dropping ${dropped} record(s) for the remainder of this frame (capacity ${cap} × ${this.recordStride}B = ${(this.byteSize / 1024).toFixed(0)} KB)`,
    )
  }
}
