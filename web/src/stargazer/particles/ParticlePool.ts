import { SlotPool } from './SlotPool'

/**
 * Structure-of-arrays storage for a {@link ParticlePool}. Each field is a
 * parallel typed array indexed by slot; a slot is live when `alive[i] === 1`.
 *
 * @category Particles
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
  /**
   * Current rotation, radians. 0 for a particle whose config has no
   * `spinRadPerSec`.
   */
  angle: Float32Array
  /** Per-particle constant angular velocity, rad/s, sampled at spawn. */
  spin: Float32Array
  /**
   * Launch speed magnitude (world units/s), sampled at spawn. Drives `scaleBy:
   * 'speed'` and `minSpeedFrac`.
   */
  speed0: Float32Array
}

/**
 * Fixed-capacity particle pool. All storage is allocated once at construction;
 * per-frame `spawn`/`kill`/`clear` are allocation-free. Slot allocation itself
 * (the freelist, `highWaterIndex`, `aliveCount`) is delegated to `SlotPool`;
 * this class pairs that with the fixed {@link ParticleField} typed arrays and
 * mirrors liveness into `field.alive` so draw loops can read it directly
 * without going through the pool.
 *
 * @category Particles
 */
export class ParticlePool {
  readonly capacity: number
  readonly field: ParticleField

  readonly #slots: SlotPool

  constructor(capacity: number) {
    this.#slots = new SlotPool(capacity)
    this.capacity = this.#slots.capacity
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
      angle: new Float32Array(this.capacity),
      spin: new Float32Array(this.capacity),
      speed0: new Float32Array(this.capacity),
    }
  }

  get aliveCount(): number {
    return this.#slots.aliveCount
  }
  get availableCount(): number {
    return this.#slots.availableCount
  }
  /** Inclusive upper bound for `update()` / `draw()` loops. */
  get highWaterIndex(): number {
    return this.#slots.highWaterIndex
  }

  /**
   * Claim a free slot. Returns the slot index or -1 when the pool is exhausted.
   * Caller is responsible for initialising the slot's fields.
   */
  spawn(): number {
    const idx = this.#slots.spawn()
    if (idx >= 0) this.field.alive[idx] = 1
    return idx
  }

  /** Return a slot to the freelist. Safe to call on already-dead slots. */
  kill(idx: number): void {
    if (idx < 0 || idx >= this.capacity) return
    this.field.alive[idx] = 0
    this.#slots.kill(idx)
  }

  /** Return every slot to the freelist. Cheap, just zeroes the alive mask. */
  clear(): void {
    for (let i = 0; i < this.#slots.highWaterIndex; i++) {
      this.field.alive[i] = 0
    }
    this.#slots.clear()
  }
}
