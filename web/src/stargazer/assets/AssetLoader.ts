/**
 * A keyed async cache. Register a factory once per key; repeat loads of the
 * same key return the same memoized Promise, so a one-time cost (fetching and
 * parsing SVG artwork, building a `BitmapMask`) is paid once even across scene
 * reloads. A factory that rejects is evicted so the next load retries.
 *
 * @category Assets
 * @example
 *   const assets = new AssetLoader()
 *   const svg = await assets.load('map', () =>
 *     fetch('/map.svg').then((r) => r.text()),
 *   )
 */
export class AssetLoader {
  readonly #cache = new Map<string, Promise<unknown>>()

  /**
   * Return the cached Promise for `key`, or run `factory` to create and cache
   * it.
   */
  async load<T>(key: string, factory: () => Promise<T>): Promise<T> {
    let entry = this.#cache.get(key) as Promise<T> | undefined
    if (!entry) {
      entry = factory()
      this.#cache.set(key, entry)
      // If the factory rejects, evict so the next call can retry.
      entry.catch(() => this.#cache.delete(key))
    }
    return entry
  }

  /** Whether a load is registered for `key` (even one still pending). */
  has(key: string): boolean {
    return this.#cache.has(key)
  }

  /** Drop every cached entry. Promises already handed out still resolve. */
  clear(): void {
    this.#cache.clear()
  }
}
