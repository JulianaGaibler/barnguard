import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GpuGfx } from './GpuGfx'
import { MockGfxDevice } from './webgl2/mockGfxDevice'

// happy-dom's <canvas> doesn't return a real WebGL2 context, but GpuGfx only
// needs it for `canvas.width` / `canvas.height` bookkeeping and the FBO blit
// destination. All GL calls go through the mock device.
function makeCanvas(): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = 400
  c.height = 300
  return c
}

function makeGpuGfx(): {
  gfx: GpuGfx
  device: MockGfxDevice
  canvas: HTMLCanvasElement
} {
  const canvas = makeCanvas()
  const device = new MockGfxDevice()
  const gfx = new GpuGfx(canvas, device)
  return { gfx, device, canvas }
}

function baseFrame(gfx: GpuGfx, device: MockGfxDevice): void {
  device.reset()
  gfx.beginFrame({
    clearColor: '#0d1a2c',
    transparent: false,
    pixelW: 400,
    pixelH: 300,
  })
  // Install a trivial base transform (identity in device px).
  gfx.setBaseTransform(1, 0, 0, 1, 0, 0)
  gfx.setAlpha(1)
}

describe('GpuGfx batching, fillRect', () => {
  it('collapses many fillRects into a single colored-tri draw', () => {
    const { gfx, device } = makeGpuGfx()
    baseFrame(gfx, device)
    for (let i = 0; i < 1000; i++) {
      // Vary alpha and color per rect, none of these should force a flush.
      gfx.setAlpha((i % 12) / 12)
      gfx.fillRect(i, 0, 5, 5, i % 2 === 0 ? '#ff8040' : '#41a8ff')
    }
    gfx.endFrame()
    expect(device.draws.length).toBe(1)
    expect(device.draws[0].kind).toBe('arrays')
    // 1000 rects × 6 vertices per rect.
    expect(device.draws[0].count).toBe(1000 * 6)
  })

  it('fillPath2D on an un-registered path ticks the counter without breaking the batch', () => {
    // Phase 2 implemented every Gfx2D method that has a registered path or
    // real primitive. The last "stub" case that survives is fillPath2D /
    // strokePath2D on a Path2D whose tessellation was never registered.    // e.g. tests that hand in a raw `new Path2D()`. Those still no-op via
    // `unimplemented.fillPath2D++`, so a coloredTri batch continues.
    const { gfx, device } = makeGpuGfx()
    baseFrame(gfx, device)
    gfx.fillRect(0, 0, 5, 5, '#ff0000')
    gfx.fillPath2D(new Path2D(), '#ff0000') // unregistered → counter++
    gfx.fillRect(10, 10, 5, 5, '#00ff00')
    gfx.endFrame()
    expect(device.draws.length).toBe(1)
    expect(gfx.unimplemented.fillPath2D).toBe(1)
  })

  it('blend-mode change flushes and starts a new batch', () => {
    const { gfx, device } = makeGpuGfx()
    baseFrame(gfx, device)
    gfx.setBlend('source-over')
    gfx.fillRect(0, 0, 5, 5, '#ff0000')
    gfx.setBlend('lighter')
    gfx.fillRect(10, 0, 5, 5, '#00ff00')
    gfx.endFrame()
    expect(device.draws.length).toBe(2)
    expect(device.draws[0].blend).toBe('source-over')
    expect(device.draws[1].blend).toBe('lighter')
  })
})

describe('GpuGfx batching, drawImage / static blit', () => {
  it('drawImage of the same source coalesces into one instanced draw', () => {
    const { gfx, device } = makeGpuGfx()
    const sprite = document.createElement('canvas')
    sprite.width = 32
    sprite.height = 32
    baseFrame(gfx, device)
    for (let i = 0; i < 500; i++) {
      gfx.setAlpha((i % 8) / 8)
      gfx.drawImage(sprite, i, 0, 32, 32)
    }
    gfx.endFrame()
    expect(device.draws.length).toBe(1)
    expect(device.draws[0].kind).toBe('instanced')
    expect(device.draws[0].instanceCount).toBe(500)
  })

  it('fillRect after drawImage forces a program change → 2 draws', () => {
    const { gfx, device } = makeGpuGfx()
    const sprite = document.createElement('canvas')
    sprite.width = 32
    sprite.height = 32
    baseFrame(gfx, device)
    gfx.drawImage(sprite, 0, 0, 32, 32)
    gfx.fillRect(0, 0, 5, 5, '#ff0000')
    gfx.endFrame()
    expect(device.draws.length).toBe(2)
    // Order matters, instanced (textured-quad) first, then colored-tri.
    expect(device.draws[0].kind).toBe('instanced')
    expect(device.draws[1].kind).toBe('arrays')
    // Programs are distinct handles.
    expect(device.draws[0].program).not.toBe(device.draws[1].program)
  })

  it('different image sources force a texture bind change → 2 draws', () => {
    const { gfx, device } = makeGpuGfx()
    const spriteA = document.createElement('canvas')
    spriteA.width = 32
    spriteA.height = 32
    const spriteB = document.createElement('canvas')
    spriteB.width = 32
    spriteB.height = 32
    baseFrame(gfx, device)
    gfx.drawImage(spriteA, 0, 0, 32, 32)
    gfx.drawImage(spriteB, 32, 0, 32, 32)
    gfx.endFrame()
    expect(device.draws.length).toBe(2)
    expect(device.draws[0].texture).not.toBe(device.draws[1].texture)
  })

  it('drawImage under a rotated transform ticks the counter and is skipped', () => {
    const { gfx, device } = makeGpuGfx()
    const sprite = document.createElement('canvas')
    sprite.width = 32
    sprite.height = 32
    baseFrame(gfx, device)
    // Rotate 45°, b, c non-zero.
    const cos45 = Math.cos(Math.PI / 4)
    const sin45 = Math.sin(Math.PI / 4)
    gfx.setBaseTransform(cos45, sin45, -sin45, cos45, 0, 0)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      gfx.drawImage(sprite, 0, 0, 32, 32)
    } finally {
      warn.mockRestore()
    }
    gfx.endFrame()
    expect(device.draws.length).toBe(0)
    expect(gfx.unimplemented.drawImageWithRotation).toBe(1)
  })
})

describe('GpuGfx frame lifecycle', () => {
  it('flush() with no pending batch is a no-op', () => {
    const { gfx, device } = makeGpuGfx()
    baseFrame(gfx, device)
    gfx.flush()
    gfx.endFrame()
    expect(device.draws.length).toBe(0)
  })

  it('flush at layer boundary preserves painter order', () => {
    // Same-program back-to-back layers would normally coalesce; an explicit
    // flush() between them forces the layer-1 batch to draw before layer 2
    // starts appending. Stage relies on this to preserve painter order across
    // static / above-static / dynamic layers even when they use the same
    // program.
    const { gfx, device } = makeGpuGfx()
    baseFrame(gfx, device)
    gfx.fillRect(0, 0, 5, 5, '#ff0000')
    gfx.flush()
    gfx.fillRect(10, 0, 5, 5, '#00ff00')
    gfx.endFrame()
    expect(device.draws.length).toBe(2)
  })

  it('stats reset each frame', () => {
    const { gfx, device } = makeGpuGfx()
    baseFrame(gfx, device)
    gfx.fillRect(0, 0, 5, 5, '#ff0000')
    gfx.endFrame()
    expect(gfx.stats.drawCalls).toBe(1)
    // Start a new frame, stats zero out.
    baseFrame(gfx, device)
    expect(gfx.stats.drawCalls).toBe(0)
    gfx.endFrame()
    expect(gfx.stats.drawCalls).toBe(0)
  })
})

beforeEach(() => {
  // Some tests spy on console.warn.
  vi.restoreAllMocks()
})

// -----------------------------------------------------------------------------
// Phase 2 tests, stroke, SDF, gradient, tessellation coverage.
// -----------------------------------------------------------------------------

import * as SvgPathContours from '@src/stargazer/assets/SvgPathContours'
import { registerPathTessellation } from '@src/stargazer/render/gfx/PathTessellationRegistry'

describe('GpuGfx Phase 2. SDF batching', () => {
  it('T1: 400 fillCircles collapse into a single SDF instanced draw', () => {
    const { gfx, device } = makeGpuGfx()
    baseFrame(gfx, device)
    for (let i = 0; i < 400; i++) {
      gfx.setAlpha((i % 8) / 8)
      gfx.fillCircle(i, 0, 3, '#ffffff')
    }
    gfx.endFrame()
    expect(device.draws.length).toBe(1)
    expect(device.draws[0].kind).toBe('instanced')
    expect(device.draws[0].instanceCount).toBe(400)
    expect(gfx.stats.sdfInstances).toBe(400)
  })

  it('T4: fillCircle + strokeCircle coalesce into one SDF draw', () => {
    const { gfx, device } = makeGpuGfx()
    baseFrame(gfx, device)
    for (let i = 0; i < 50; i++) {
      gfx.fillCircle(i, 0, 3, '#ffffff')
    }
    for (let i = 0; i < 5; i++) {
      gfx.strokeCircle(i * 20, 100, 10, { color: '#41a8ff', width: 2 })
    }
    gfx.endFrame()
    // All 55 SDF instances live in the same program+blend batch.
    expect(device.draws.length).toBe(1)
    expect(device.draws[0].kind).toBe('instanced')
    expect(device.draws[0].instanceCount).toBe(55)
  })
})

describe('GpuGfx Phase 2, stroke dashStart continuity', () => {
  it('T2: 3-segment polyline accumulates dashStart across segments', () => {
    const { gfx, device } = makeGpuGfx()
    baseFrame(gfx, device)
    // Three horizontal segments, 100 device px each (identity base transform).
    const pts = new Float32Array([0, 0, 100, 0, 200, 0, 300, 0])
    gfx.strokePolyline(pts, 4, {
      color: '#ffffff',
      width: 4,
      dash: [10, 5],
    })
    gfx.endFrame()
    // Segments (3) + join discs (2 interior) = 5 stroke instances.
    expect(device.draws.length).toBe(1)
    expect(device.draws[0].kind).toBe('instanced')
    expect(device.draws[0].instanceCount).toBe(5)
    // Inspect the uploaded buffer: dashStart lives at offset 24 (bytes) of
    // each 36-byte instance record (p0.xy + p1.xy + color = 20 bytes; then
    // width (f32) + dashStart (f32) at offset 24). Segments emit first, then
    // join discs, assert dashStart on the three segments.
    const snap = device.draws[0].bufferSnapshot!
    const view = new Float32Array(snap)
    // Words per instance = 9; dashStart is word index 6 within each instance.
    const inst0DashStart = view[0 * 9 + 6]
    const inst2DashStart = view[2 * 9 + 6]
    const inst4DashStart = view[4 * 9 + 6]
    // Instances are emitted in order: seg0, join0, seg1, join1, seg2. So the
    // three segment records are at instance indices 0, 2, 4.
    expect(inst0DashStart).toBeCloseTo(0, 5)
    expect(inst2DashStart).toBeCloseTo(100, 5)
    expect(inst4DashStart).toBeCloseTo(200, 5)
  })

  it('under lighter blend, no join discs are emitted (avoids brightening)', () => {
    const { gfx, device } = makeGpuGfx()
    baseFrame(gfx, device)
    gfx.setBlend('lighter')
    const pts = new Float32Array([0, 0, 100, 0, 200, 0, 300, 0])
    gfx.strokePolyline(pts, 4, { color: '#ffffff', width: 4 })
    gfx.endFrame()
    expect(device.draws.length).toBe(1)
    // Only 3 segments, no join discs.
    expect(device.draws[0].instanceCount).toBe(3)
  })
})

describe('GpuGfx Phase 2. Path2D tessellation cache', () => {
  it('T3: fillPath2D on the same Path2D twice tessellates once', () => {
    const { gfx, device } = makeGpuGfx()
    // Register a hex tessellation manually so we don't rely on SvgPathMap.
    const contour = new Float32Array(12)
    for (let i = 0; i < 6; i++) {
      const a = (Math.PI / 3) * i
      contour[i * 2] = Math.cos(a) * 10
      contour[i * 2 + 1] = Math.sin(a) * 10
    }
    const spy = vi.spyOn(SvgPathContours, 'tessellateContours')
    const tess = SvgPathContours.tessellateContours([contour])
    // The spy captures the one manual call above; drawing shouldn't
    // trigger any additional calls because we register directly.
    const path = new Path2D()
    registerPathTessellation(path, tess, [contour])
    const callsBefore = spy.mock.calls.length

    baseFrame(gfx, device)
    gfx.fillPath2D(path, '#ffffff')
    gfx.fillPath2D(path, '#ffffff')
    gfx.endFrame()

    expect(spy.mock.calls.length).toBe(callsBefore) // no additional tessellations
    expect(device.draws.length).toBe(1) // both fillPath2D calls coalesce
    spy.mockRestore()
  })
})

describe('GpuGfx Phase 3, particle atlas', () => {
  // The atlas requires an OffscreenCanvas 2D context to composite tiles
  // into a backing store. happy-dom returns `null` from getContext('2d')
  // on OffscreenCanvas, shim with a minimal FakeOffscreen for this suite
  // only (matches the pattern in Layers.test.ts).
  const noopCtx = {
    setTransform() {},
    clearRect() {},
    fillRect() {},
    drawImage() {},
    fillStyle: '',
    beginPath() {},
    closePath() {},
    moveTo() {},
    lineTo() {},
    fill() {},
    createLinearGradient: () => ({ addColorStop() {} }),
  } as unknown as CanvasRenderingContext2D
  class FakeOffscreen {
    constructor(
      public width: number,
      public height: number,
    ) {}
    getContext(): CanvasRenderingContext2D {
      return noopCtx
    }
  }
  let originalOC: unknown
  beforeEach(() => {
    originalOC = globalThis.OffscreenCanvas
    ;(globalThis as unknown as { OffscreenCanvas: unknown }).OffscreenCanvas =
      FakeOffscreen
  })
  afterEach(() => {
    ;(globalThis as unknown as { OffscreenCanvas: unknown }).OffscreenCanvas =
      originalOC
  })

  it('T8: two distinct tagged particle sprites coalesce into ONE instanced draw', () => {
    const { gfx, device } = makeGpuGfx()
    const spriteA = document.createElement('canvas')
    spriteA.width = 64
    spriteA.height = 64
    ;(
      spriteA as unknown as Record<string, unknown>
    ).__isParticleAtlasCandidate = true
    const spriteB = document.createElement('canvas')
    spriteB.width = 64
    spriteB.height = 64
    ;(
      spriteB as unknown as Record<string, unknown>
    ).__isParticleAtlasCandidate = true
    baseFrame(gfx, device)
    gfx.drawImage(spriteA, 0, 0, 64, 64)
    gfx.drawImage(spriteB, 64, 0, 64, 64)
    gfx.endFrame()
    // The two sprites share the SAME atlas texture, so they coalesce.
    expect(device.draws.length).toBe(1)
    expect(device.draws[0].instanceCount).toBe(2)
    // The atlas received exactly TWO sub-image uploads (one per registered
    // tile), not a full 4 MB re-upload.
    expect(device.subImageUploads.length).toBe(2)
  })

  it('untagged canvases still fall through to per-source textures', () => {
    const { gfx, device } = makeGpuGfx()
    const untaggedA = document.createElement('canvas')
    untaggedA.width = 64
    untaggedA.height = 64
    const untaggedB = document.createElement('canvas')
    untaggedB.width = 64
    untaggedB.height = 64
    baseFrame(gfx, device)
    gfx.drawImage(untaggedA, 0, 0, 64, 64)
    gfx.drawImage(untaggedB, 64, 0, 64, 64)
    gfx.endFrame()
    // Different per-source textures → 2 draws.
    expect(device.draws.length).toBe(2)
    // No sub-image uploads.
    expect(device.subImageUploads.length).toBe(0)
  })
})

describe('GpuGfx Phase 2. EpicenterNode-shape frame', () => {
  it('T5: dashed ring + solid ring + fill disc coalesce into ONE SDF batch', () => {
    const { gfx, device } = makeGpuGfx()
    baseFrame(gfx, device)
    // Rings + fill disc: all SDF instances, same batch.
    gfx.strokeCircle(50, 50, 20, { color: '#41a8ff', width: 2, dash: [4, 4] })
    gfx.strokeCircle(50, 50, 30, { color: '#41a8ff', width: 1 })
    gfx.fillCircle(50, 50, 4, '#ffffff')
    gfx.strokeCircle(50, 50, 45, { color: '#41a8ff', width: 1 })
    gfx.endFrame()
    expect(device.draws.length).toBe(1)
    expect(device.draws[0].kind).toBe('instanced')
    expect(device.draws[0].instanceCount).toBe(4)
  })

  // Note: fillCircleRadialGradient is not covered by a mock-device test.  // its LUT construction goes through OffscreenCanvas.getContext('2d'),
  // which returns null under happy-dom (no real 2D canvas). Visual parity
  // for the epicenter pulse is covered by the manual browser diff at the
  // Phase 2 verification step.
})
