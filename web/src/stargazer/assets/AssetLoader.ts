/**
 * Tiny keyed async cache. Callers register a factory once per key; subsequent
 * loads of the same key return the same Promise (memoized). Useful for paying
 * the SVG-parse / BitmapMask-build cost only once, even across scene reloads.
 */
export class AssetLoader {
  private readonly cache = new Map<string, Promise<unknown>>()

  async load<T>(key: string, factory: () => Promise<T>): Promise<T> {
    let entry = this.cache.get(key) as Promise<T> | undefined
    if (!entry) {
      entry = factory()
      this.cache.set(key, entry)
      // If the factory rejects, evict so the next call can retry.
      entry.catch(() => this.cache.delete(key))
    }
    return entry
  }

  has(key: string): boolean {
    return this.cache.has(key)
  }

  clear(): void {
    this.cache.clear()
  }
}
