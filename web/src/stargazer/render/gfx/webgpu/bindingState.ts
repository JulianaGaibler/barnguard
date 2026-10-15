/**
 * Tracks which vertex buffers, index buffer and bind groups the open render
 * pass already holds, so a draw sets only what differs from the draw before
 * it.
 *
 * @remarks
 *   For engine developers: a WebGPU render pass starts with nothing bound, and
 *   what a draw sets stays set for the next one. Every encoder call crosses
 *   into the browser's GPU process, so repeating a bind that is already in
 *   place costs time and changes nothing. The owner calls
 *   {@link PassBindingState.reset} when a pass begins. Bind groups compare by
 *   object plus their dynamic offsets.
 * @example
 *   if (state.vertexBufferChanged(0, buffer, offset))
 *     pass.setVertexBuffer(0, buffer, offset)
 */
export class PassBindingState<Buffer extends object, Group extends object> {
  readonly #vertexBuffers: (Buffer | null)[] = []
  readonly #vertexOffsets: number[] = []
  #indexBuffer: Buffer | null = null
  #indexFormat = ''
  readonly #groups: (Group | null)[] = []
  readonly #groupOffsets: (readonly number[] | undefined)[] = []

  /** True when `slot` must be set, and records the new binding. */
  vertexBufferChanged(slot: number, buffer: Buffer, offset: number): boolean {
    if (
      this.#vertexBuffers[slot] === buffer &&
      this.#vertexOffsets[slot] === offset
    ) {
      return false
    }
    this.#vertexBuffers[slot] = buffer
    this.#vertexOffsets[slot] = offset
    return true
  }

  /** True when the index buffer or its format differs from the current one. */
  indexBufferChanged(buffer: Buffer, format: string): boolean {
    if (this.#indexBuffer === buffer && this.#indexFormat === format) {
      return false
    }
    this.#indexBuffer = buffer
    this.#indexFormat = format
    return true
  }

  /** True when `group` must be set with this bind group and dynamic offsets. */
  bindGroupChanged(
    group: number,
    bindGroup: Group,
    dynamicOffsets?: readonly number[],
  ): boolean {
    if (
      this.#groups[group] === bindGroup &&
      sameOffsets(this.#groupOffsets[group], dynamicOffsets)
    ) {
      return false
    }
    this.#groups[group] = bindGroup
    this.#groupOffsets[group] = dynamicOffsets?.slice()
    return true
  }

  /** Forget everything, as a new render pass starts empty. */
  reset(): void {
    this.#vertexBuffers.length = 0
    this.#vertexOffsets.length = 0
    this.#indexBuffer = null
    this.#indexFormat = ''
    this.#groups.length = 0
    this.#groupOffsets.length = 0
  }
}

function sameOffsets(
  a: readonly number[] | undefined,
  b: readonly number[] | undefined,
): boolean {
  const la = a?.length ?? 0
  const lb = b?.length ?? 0
  if (la !== lb) return false
  for (let i = 0; i < la; i++) if (a![i] !== b![i]) return false
  return true
}
