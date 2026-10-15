/**
 * Remembers what each indexed uniform buffer binding point holds, so a draw
 * that binds the same buffer range as the previous draw issues no GL call.
 *
 * @remarks
 *   For engine developers: every GL call is a message to the GPU process in
 *   Firefox, and a 2D frame binds the same clip, frame and params ranges over
 *   and over. A deleted buffer needs no invalidation here, because a new buffer
 *   is a different object and so never compares equal. A lost context drops
 *   every binding, so the owner calls {@link UniformBindingCache.clear}.
 * @example
 *   if (cache.needsBind(3, ubo.gl, offset, size)) {
 *     gl.bindBufferRange(gl.UNIFORM_BUFFER, 3, ubo.gl, offset, size)
 *   }
 */
export class UniformBindingCache {
  readonly #buffers: (object | null)[] = []
  readonly #offsets: number[] = []
  readonly #sizes: number[] = []

  /**
   * Whether binding `buffer` at `point` with this range changes anything, and
   * records it as bound when it does. `size` is `-1` for a whole-buffer bind.
   */
  needsBind(
    point: number,
    buffer: object,
    offset: number,
    size: number,
  ): boolean {
    if (
      this.#buffers[point] === buffer &&
      this.#offsets[point] === offset &&
      this.#sizes[point] === size
    ) {
      return false
    }
    this.#buffers[point] = buffer
    this.#offsets[point] = offset
    this.#sizes[point] = size
    return true
  }

  /** Forget every binding. */
  clear(): void {
    this.#buffers.length = 0
    this.#offsets.length = 0
    this.#sizes.length = 0
  }
}
