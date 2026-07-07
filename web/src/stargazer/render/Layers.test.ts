import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Layers } from './Layers'

// happy-dom exposes `OffscreenCanvas` but returns no real 2D context, so we
// inject a minimal fake to exercise the ImageBitmap bake path deterministically.
// `liveBitmaps` is the ground-truth leak metric: it counts fakes that have been
// transferred but not yet `.close()`d, independent of Layers' own accounting.
let liveBitmaps = 0

class FakeBitmap {
  private closed = false
  close(): void {
    if (this.closed) return
    this.closed = true
    liveBitmaps--
  }
}

const noopCtx = {
  setTransform() {},
  clearRect() {},
  fillRect() {},
  drawImage() {},
} as unknown as CanvasRenderingContext2D

class FakeOffscreen {
  constructor(
    public width: number,
    public height: number,
  ) {}
  getContext(): CanvasRenderingContext2D {
    return noopCtx
  }
  transferToImageBitmap(): ImageBitmap {
    liveBitmaps++
    return new FakeBitmap() as unknown as ImageBitmap
  }
}

const original = globalThis.OffscreenCanvas

beforeEach(() => {
  liveBitmaps = 0
  ;(globalThis as unknown as { OffscreenCanvas: unknown }).OffscreenCanvas =
    FakeOffscreen
})

afterEach(() => {
  ;(globalThis as unknown as { OffscreenCanvas: unknown }).OffscreenCanvas =
    original
})

function bake(layers: Layers, w = 64, h = 64): void {
  layers.ensureSize(w, h)
  layers.clearBake()
  layers.recordBake()
}

describe('Layers (ImageBitmap bake path)', () => {
  it('counts bakes and never holds more than two bitmaps across rebakes', () => {
    const layers = new Layers()
    for (let i = 0; i < 6; i++) {
      bake(layers)
      expect(layers.activeBitmaps).toBeLessThanOrEqual(2)
      expect(liveBitmaps).toBeLessThanOrEqual(2)
    }
    expect(layers.totalBakes).toBe(6)
    // Steady state: exactly one sealed bitmap held.
    expect(layers.activeBitmaps).toBe(1)
    expect(liveBitmaps).toBe(1)
  })

  it('closes the stale bitmap when the bake size changes', () => {
    const layers = new Layers()
    bake(layers, 64, 64)
    layers.ensureSize(128, 128) // resize must drop the old-size bitmap
    expect(layers.activeBitmaps).toBe(0)
    expect(liveBitmaps).toBe(0)
    bake(layers, 128, 128)
    expect(layers.activeBitmaps).toBe(1)
    expect(liveBitmaps).toBe(1)
  })

  it('releases everything on dispose', () => {
    const layers = new Layers()
    bake(layers)
    layers.dispose()
    expect(layers.activeBitmaps).toBe(0)
    expect(liveBitmaps).toBe(0)
  })

  it('T6: activeBitmaps stays ≤ 1 under a reproject-heavy GPU sequence', () => {
    // Phase 3 GPU path: on settle → bake + upload + blit; during camera
    // motion → reproject-blit (no re-bake). The bitmap lifecycle only ticks
    // on `recordBake`, so the invariant is that consecutive `getBakeSource()`
    // reads between bakes DO NOT leak bitmaps.
    const layers = new Layers()
    for (let cycle = 0; cycle < 10; cycle++) {
      bake(layers) // settle → new bake
      for (let motionFrame = 0; motionFrame < 5; motionFrame++) {
        // Simulated reproject frames: just re-read the bake source. The
        // GPU backend reads without touching Layers' state.
        const src = layers.getBakeSource()
        expect(src).not.toBeNull()
      }
      expect(layers.activeBitmaps).toBeLessThanOrEqual(1)
      expect(liveBitmaps).toBeLessThanOrEqual(1)
    }
    expect(layers.activeBitmaps).toBe(1)
    expect(liveBitmaps).toBe(1)
  })
})
