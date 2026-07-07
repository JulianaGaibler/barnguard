// Vitest setup; minimal shims for browser APIs happy-dom doesn't ship
// but that stargazer needs at construction time. The shims are structural
// no-ops; anything that actually rasterises (isPointInPath, getImageData) is
// verified visually in `?demo=…` sandbox scenes, not here.

// happy-dom does not always attach `localStorage` in the current Node
// version; install a tiny in-memory shim so tests that persist scores /
// locale work without --localstorage-file.
if (typeof (globalThis as { localStorage?: unknown }).localStorage === 'undefined') {
  const store = new Map<string, string>()
  const shim: Storage = {
    get length() {
      return store.size
    },
    clear() {
      store.clear()
    },
    getItem(key: string) {
      return store.has(key) ? store.get(key)! : null
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null
    },
    removeItem(key: string) {
      store.delete(key)
    },
    setItem(key: string, value: string) {
      store.set(key, String(value))
    },
  }
  ;(globalThis as unknown as { localStorage: Storage }).localStorage = shim
}

if (typeof (globalThis as { Path2D?: unknown }).Path2D === 'undefined') {
  class Path2DStub {
    constructor(_d?: string | Path2DStub) {
      // Intentionally empty; construction is all the tests exercise.
    }
    addPath(): void {}
    closePath(): void {}
    moveTo(): void {}
    lineTo(): void {}
    bezierCurveTo(): void {}
    quadraticCurveTo(): void {}
    arc(): void {}
    arcTo(): void {}
    ellipse(): void {}
    rect(): void {}
    roundRect(): void {}
  }
  ;(
    globalThis as unknown as { Path2D: typeof Path2DStub }
  ).Path2D = Path2DStub
}
