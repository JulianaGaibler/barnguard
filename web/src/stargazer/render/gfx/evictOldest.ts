/**
 * Removes the oldest entry of a `Map`, in insertion order, and returns it.
 *
 * @remarks
 *   For engine developers: caches here are a `Map` used as a FIFO, or as an LRU
 *   when a hit deletes and re-sets its key. Evicting with `map.keys().next()`
 *   leaves one unfinished iterator behind per eviction. SpiderMonkey keeps
 *   unfinished iterators attached to their map until they are garbage collected
 *   and updates every one of them on each `delete`, so a cache that evicts on
 *   every miss gets slower with each eviction. This function keeps one iterator
 *   per map and reuses it. Its next key is always the oldest live entry,
 *   because evicted entries lie behind it and re-set entries are appended after
 *   it.
 * @example
 *   if (cache.size > MAX) {
 *     const victim = evictOldest(cache)
 *     if (victim) release(victim[1])
 *   }
 */
export function evictOldest<K, V>(map: Map<K, V>): [K, V] | undefined {
  let cursor = cursors.get(map) as Iterator<K> | undefined
  let step = cursor?.next()
  if (!cursor || !step || step.done) {
    // A finished iterator stays finished, so entries added after it ran out
    // need a fresh one.
    cursor = map.keys()
    cursors.set(map, cursor)
    step = cursor.next()
  }
  if (step.done) return undefined
  const key = step.value
  const value = map.get(key) as V
  map.delete(key)
  return [key, value]
}

const cursors = new WeakMap<Map<unknown, unknown>, Iterator<unknown>>()
