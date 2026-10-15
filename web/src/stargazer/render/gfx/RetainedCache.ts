/** Something a {@link RetainedCache} keeps: its size, and how to free it. */
export interface RetainedEntry {
  /** GPU memory the entry holds. */
  readonly bytes: number
  /** Free what the entry holds. Called once, when the cache drops it. */
  release(): void
}

/** What a `RetainedCache` holds and did, for the debug HUD. */
export interface RetainedCacheStats {
  readonly name: string
  readonly entries: number
  readonly bytes: number
  readonly budget: number
  /** Entries drawn from the cache in the last frame. */
  readonly hits: number
  /** Entries admitted in the last frame. */
  readonly admitted: number
  /** Entries dropped since the cache was made. */
  readonly evicted: number
}

export interface RetainedCacheOptions {
  /** Shown in the debug HUD. */
  name: string
  /** Frames an entry may go unused before it is dropped. */
  idleFrames: number
  /** Most memory the cache holds before it drops the least recently used. */
  budgetBytes: number
}

interface Slot<E extends RetainedEntry> {
  entry: E
  lastFrame: number
}

/**
 * The renderer's policy for keeping drawing work between frames. It decides
 * what is worth keeping and for how long, and the caller owns the storage: an
 * entry is anything with a size and a way to free it.
 *
 * Something is kept on its second frame in a row with the same key, so content
 * that changes every frame never takes memory. An entry unused for `idleFrames`
 * is dropped, and past the budget the least recently used go first, though
 * never one used in the current frame.
 *
 * @remarks
 *   Engine developers: every cache of drawing work that lives across frames sits
 *   on this policy, so admission, eviction and the HUD readout stay the same
 *   everywhere. Admit only what costs no extra draw call to keep.
 */
export class RetainedCache<E extends RetainedEntry> {
  readonly #opts: RetainedCacheOptions
  readonly #slots = new Map<string, Slot<E>>()
  readonly #seen = new Map<string, number>()
  readonly #ids = new WeakMap<object, number>()
  #nextId = 1
  #bytes = 0
  #hits = 0
  #admitted = 0
  #evicted = 0
  #frame = 0

  constructor(opts: RetainedCacheOptions) {
    this.#opts = opts
  }

  /** The key for `source` under `signature`. */
  keyFor(source: object, signature: string): string {
    let id = this.#ids.get(source)
    if (id === undefined) {
      id = this.#nextId++
      this.#ids.set(source, id)
    }
    return `${id}|${signature}`
  }

  /** Whether an entry is kept under `key`. */
  has(key: string): boolean {
    return this.#slots.has(key)
  }

  /** The entry for `key`, marked as used this frame, or `null`. */
  get(key: string): E | null {
    const slot = this.#slots.get(key)
    if (!slot) return null
    slot.lastFrame = this.#frame
    this.#hits++
    return slot.entry
  }

  /**
   * Note that `key` was wanted this frame, and report whether it was also
   * wanted in the frame before, which is when it is worth keeping.
   */
  admit(key: string): boolean {
    const last = this.#seen.get(key)
    this.#seen.set(key, this.#frame)
    return last === this.#frame - 1
  }

  /** Keep `entry` under `key`, replacing and freeing any entry there. */
  add(key: string, entry: E): E {
    const old = this.#slots.get(key)
    if (old) this.#drop(key, old)
    this.#slots.set(key, { entry, lastFrame: this.#frame })
    this.#bytes += entry.bytes
    this.#admitted++
    return entry
  }

  /**
   * Start frame `frame`: drop what went unused, then the oldest while over
   * budget, and reset the per-frame counts.
   */
  sweep(frame: number): void {
    this.#frame = frame
    this.#hits = 0
    this.#admitted = 0
    const idle = this.#opts.idleFrames
    for (const [key, slot] of this.#slots) {
      if (frame - slot.lastFrame > idle) this.#drop(key, slot)
    }
    for (const [key, last] of this.#seen) {
      if (frame - last > 1) this.#seen.delete(key)
    }
    if (this.#bytes <= this.#opts.budgetBytes) return
    const byAge = [...this.#slots].sort(
      (a, b) => a[1].lastFrame - b[1].lastFrame,
    )
    for (const [key, slot] of byAge) {
      if (this.#bytes <= this.#opts.budgetBytes) break
      if (slot.lastFrame >= frame - 1) break
      this.#drop(key, slot)
    }
  }

  /**
   * Forget every entry. With `release` false the entries are not freed, for a
   * rebuilt device whose resources are already gone.
   */
  clear(release = true): void {
    if (release) {
      for (const slot of this.#slots.values()) slot.entry.release()
    }
    this.#evicted += this.#slots.size
    this.#slots.clear()
    this.#seen.clear()
    this.#bytes = 0
  }

  get stats(): RetainedCacheStats {
    return {
      name: this.#opts.name,
      entries: this.#slots.size,
      bytes: this.#bytes,
      budget: this.#opts.budgetBytes,
      hits: this.#hits,
      admitted: this.#admitted,
      evicted: this.#evicted,
    }
  }

  #drop(key: string, slot: Slot<E>): void {
    this.#slots.delete(key)
    this.#bytes -= slot.entry.bytes
    this.#evicted++
    slot.entry.release()
  }
}
