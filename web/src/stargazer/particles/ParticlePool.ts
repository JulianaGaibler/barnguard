/**
 * Parallel-Float32Array particle pool with an index freelist. Allocation
 * happens once at construction; per-frame emit/update/kill are all
 * allocation-free.
 */
export interface ParticleField {
  x: Float32Array
  y: Float32Array
  vx: Float32Array
  vy: Float32Array
  life: Float32Array
  maxLife: Float32Array
  size: Float32Array
  colorIdx: Uint8Array
  /** 1 = live, 0 = free-listed. */
  alive: Uint8Array
}

export class ParticlePool {
  readonly capacity: number
  readonly field: ParticleField

  /** Stack of currently-free slot indices; top-of-stack is at `freeTop - 1`. */
  private readonly freelist: Int32Array
  private freeTop: number
  /** Highest slot index that has EVER been alive; bounds the update loop. */
  private highWater = 0
  private _aliveCount = 0

  constructor(capacity: number) {
    if (capacity <= 0 || !Number.isFinite(capacity)) {
      throw new Error(
        `ParticlePool: capacity must be a positive integer (got ${capacity})`,
      )
    }
    this.capacity = capacity | 0
    this.field = {
      x: new Float32Array(this.capacity),
      y: new Float32Array(this.capacity),
      vx: new Float32Array(this.capacity),
      vy: new Float32Array(this.capacity),
      life: new Float32Array(this.capacity),
      maxLife: new Float32Array(this.capacity),
      size: new Float32Array(this.capacity),
      colorIdx: new Uint8Array(this.capacity),
      alive: new Uint8Array(this.capacity),
    }
    this.freelist = new Int32Array(this.capacity)
    // Prefill the freelist in reverse so `spawn()` returns index 0 first,
    // 1 next, etc, deterministic and easier to reason about.
    for (let i = 0; i < this.capacity; i++) {
      this.freelist[i] = this.capacity - 1 - i
    }
    this.freeTop = this.capacity
  }

  get aliveCount(): number {
    return this._aliveCount
  }
  get availableCount(): number {
    return this.freeTop
  }
  /** Inclusive upper bound for `update()` / `draw()` loops. */
  get highWaterIndex(): number {
    return this.highWater
  }

  /**
   * Claim a free slot. Returns the slot index or -1 when the pool is exhausted.
   * Caller is responsible for initialising the slot's fields.
   */
  spawn(): number {
    if (this.freeTop === 0) return -1
    this.freeTop--
    const idx = this.freelist[this.freeTop]
    this.field.alive[idx] = 1
    this._aliveCount++
    if (idx + 1 > this.highWater) this.highWater = idx + 1
    return idx
  }

  /** Return a slot to the freelist. Safe to call on already-dead slots. */
  kill(idx: number): void {
    if (idx < 0 || idx >= this.capacity) return
    if (this.field.alive[idx] === 0) return
    this.field.alive[idx] = 0
    this.freelist[this.freeTop] = idx
    this.freeTop++
    this._aliveCount--
  }

  /** Return every slot to the freelist. Cheap, just zeroes the alive mask. */
  clear(): void {
    for (let i = 0; i < this.highWater; i++) {
      this.field.alive[i] = 0
    }
    this._aliveCount = 0
    for (let i = 0; i < this.capacity; i++) {
      this.freelist[i] = this.capacity - 1 - i
    }
    this.freeTop = this.capacity
    this.highWater = 0
  }
}
