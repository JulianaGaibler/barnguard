// Double-buffered CPU→GPU vertex/instance streaming for one draw program.

import type { GfxDevice, VBuffer } from '../GfxDevice'
import { RING_SIZE } from './batchLayout'

/**
 * Double-buffered CPU staging + GPU VBOs. Dual views (float, uint) alias one
 * shared ArrayBuffer we memcpy per flush. Overflow warns and skips.
 */
export class RingStream {
  readonly buffers: VBuffer[] = new Array(RING_SIZE)
  readonly cpuBuffer: ArrayBuffer
  readonly floatView: Float32Array
  readonly uintView: Uint32Array
  readonly pendingWords: Uint32Array = new Uint32Array(RING_SIZE)
  readonly pendingVerts: Uint32Array = new Uint32Array(RING_SIZE)
  readonly pendingInstances: Uint32Array = new Uint32Array(RING_SIZE)
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

  reset(slot: number): void {
    this.pendingWords[slot] = 0
    this.pendingVerts[slot] = 0
    this.pendingInstances[slot] = 0
    this.#warned = false
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

  /** Called after `updateBufferSubData` on flush, resets the cursor. */
  commitFlushed(slot: number): void {
    this.pendingWords[slot] = 0
    this.pendingVerts[slot] = 0
    this.pendingInstances[slot] = 0
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
