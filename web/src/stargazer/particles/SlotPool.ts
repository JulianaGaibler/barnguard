/**
 * Fixed-capacity index allocator with a freelist. Owns no per-slot data
 * itself — callers keep their own typed arrays sized to `capacity` and use
 * the indices `spawn()` hands out to index into them. Shared by
 * {@link ParticlePool} (which pairs it with a fixed `ParticleField`) and
 * `VectorParticleNode` (which pairs it with whatever fields a subclass
 * declares).
 *
 * `kill` is fully self-contained and idempotent: it tracks its own active
 * bit per slot, so calling it twice on the same index (a caller bug, a
 * re-entrant destroy path, anything) can never double-free a slot into the
 * freelist and hand the same index to two live occupants at once.
 *
 * @category Particles
 */
export class SlotPool {
  readonly capacity: number

  /** Stack of currently-free slot indices; top-of-stack is at `freeTop - 1`. */
  readonly #freelist: Int32Array
  #freeTop: number
  /** 1 = claimed via `spawn()` and not yet `kill()`ed, 0 = free. */
  readonly #active: Uint8Array
  /** Highest slot index that has EVER been active; bounds a caller's update loop. */
  #highWater = 0
  #_aliveCount = 0

  constructor(capacity: number) {
    if (capacity <= 0 || !Number.isFinite(capacity)) {
      throw new Error(
        `SlotPool: capacity must be a positive integer (got ${capacity})`,
      )
    }
    this.capacity = capacity | 0
    this.#freelist = new Int32Array(this.capacity)
    this.#active = new Uint8Array(this.capacity)
    // Prefill the freelist in reverse so `spawn()` returns index 0 first,
    // 1 next, etc, deterministic and easier to reason about.
    for (let i = 0; i < this.capacity; i++) {
      this.#freelist[i] = this.capacity - 1 - i
    }
    this.#freeTop = this.capacity
  }

  get aliveCount(): number {
    return this.#_aliveCount
  }
  get availableCount(): number {
    return this.#freeTop
  }
  /** Inclusive upper bound for a caller's own `update()` / `draw()` loops. */
  get highWaterIndex(): number {
    return this.#highWater
  }

  /**
   * Claim a free slot. Returns the slot index or -1 when the pool is
   * exhausted. Caller is responsible for initialising the slot's own data.
   */
  spawn(): number {
    if (this.#freeTop === 0) return -1
    this.#freeTop--
    const idx = this.#freelist[this.#freeTop]
    this.#active[idx] = 1
    this.#_aliveCount++
    if (idx + 1 > this.#highWater) this.#highWater = idx + 1
    return idx
  }

  /** Return a slot to the freelist. Safe to call on an already-dead slot. */
  kill(idx: number): void {
    if (idx < 0 || idx >= this.capacity) return
    if (this.#active[idx] === 0) return
    this.#active[idx] = 0
    this.#freelist[this.#freeTop] = idx
    this.#freeTop++
    this.#_aliveCount--
  }

  /** Return every slot to the freelist. Cheap, just zeroes the active mask. */
  clear(): void {
    for (let i = 0; i < this.#highWater; i++) {
      this.#active[i] = 0
    }
    this.#_aliveCount = 0
    for (let i = 0; i < this.capacity; i++) {
      this.#freelist[i] = this.capacity - 1 - i
    }
    this.#freeTop = this.capacity
    this.#highWater = 0
  }
}
