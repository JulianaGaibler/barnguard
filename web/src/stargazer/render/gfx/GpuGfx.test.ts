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

async function baseFrame(gfx: GpuGfx, device: MockGfxDevice): Promise<void> {
  await gfx.whenReady // pipelines warm asynchronously
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

describe('GpuGfx pipeline failures', () => {
  it('reports a program whose pipelines fail and keeps the rest ready', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const device = new MockGfxDevice()
    const real = device.createPipeline.bind(device)
    let calls = 0
    vi.spyOn(device, 'createPipeline').mockImplementation((desc) =>
      calls++ === 0 ? Promise.reject(new Error('bad wgsl')) : real(desc),
    )
    const gfx = new GpuGfx(makeCanvas(), device)
    await gfx.whenReady
    expect(gfx.ready).toBe(true)
    expect(gfx.failures.list).toHaveLength(1)
    expect(gfx.failures.list[0].message).toBe('bad wgsl')
    expect(calls).toBeGreaterThan(1)
    error.mockRestore()
  })
})

describe('GpuGfx batching, fillRect', () => {
  it('collapses many fillRects into a single colored-tri draw', async () => {
    const { gfx, device } = makeGpuGfx()
    await baseFrame(gfx, device)
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

  it('fillPath2D on an un-registered path ticks the counter without breaking the batch', async () => {
    // fillPath2D and strokePath2D are the only Gfx2D calls that can reach a
    // no-op path: a Path2D whose tessellation was never registered, such as a
    // raw `new Path2D()`. They tick `unimplemented.fillPath2D` and leave the
    // open coloredTri batch alone.
    const { gfx, device } = makeGpuGfx()
    await baseFrame(gfx, device)
    gfx.fillRect(0, 0, 5, 5, '#ff0000')
    gfx.fillPath2D(new Path2D(), '#ff0000') // unregistered -> counter++
    gfx.fillRect(10, 10, 5, 5, '#00ff00')
    gfx.endFrame()
    expect(device.draws.length).toBe(1)
    expect(gfx.unimplemented.fillPath2D).toBe(1)
  })

  it('blend-mode change flushes and starts a new batch', async () => {
    const { gfx, device } = makeGpuGfx()
    await baseFrame(gfx, device)
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

describe('GpuGfx Phase 1, record/submit split', () => {
  it('uploads each stream once and replays runs in painter order with append offsets', async () => {
    const { gfx, device } = makeGpuGfx()
    await baseFrame(gfx, device)
    // Interleave two colored-tri fills around one shape circle. The circle breaks
    // the colored-tri batch, so colored-tri produces two runs from one stream.
    gfx.fillRect(0, 0, 10, 10, '#ff0000') // colored-tri run A: 6 verts at word 0
    gfx.fillCircle(50, 50, 5, '#00ff00') // shape run: breaks the colored-tri batch
    gfx.fillRect(48, 48, 10, 10, '#0000ff') // colored-tri run C: appended, not reset
    gfx.endFrame()

    // Three runs replayed in painter order: fill, circle, fill.
    expect(device.draws.map((d) => d.kind)).toEqual([
      'arrays',
      'instancedRange',
      'arrays',
    ])

    // One upload per used stream, even though colored-tri drew twice. Two
    // distinct streams (colored-tri + shape), each uploaded exactly once.
    const uploadsPerBuffer = new Map<unknown, number>()
    for (const u of device.uploads) {
      uploadsPerBuffer.set(u.buffer, (uploadsPerBuffer.get(u.buffer) ?? 0) + 1)
    }
    expect(uploadsPerBuffer.size).toBe(2)
    for (const count of uploadsPerBuffer.values()) {
      expect(count).toBe(1)
    }

    // Append-not-reset: both colored-tri runs share one program+buffer, and the
    // second run starts at vertex 6 (after the first rect's 6 verts), not 0.
    expect(device.draws[0].program).toBe(device.draws[2].program)
    expect(device.draws[0].first).toBe(0)
    expect(device.draws[0].count).toBe(6)
    expect(device.draws[2].first).toBe(6)
    expect(device.draws[2].count).toBe(6)
  })
})

describe('GpuGfx batching, merging runs', () => {
  it('joins a draw to an earlier run across draws it does not overlap', async () => {
    const { gfx, device } = makeGpuGfx()
    await baseFrame(gfx, device)
    gfx.fillCircle(10, 10, 5, '#f00')
    gfx.fillRect(100, 100, 10, 10, '#0f0')
    gfx.fillCircle(30, 10, 5, '#00f')
    gfx.endFrame()
    // The second circle shares nothing with the rect, so both circles draw
    // together.
    expect(device.draws.map((d) => d.kind)).toEqual([
      'instancedRange',
      'arrays',
    ])
    expect(device.draws[0].instanceCount).toBe(2)
    expect(gfx.stats.runsMerged).toBe(1)
  })

  it('keeps painter order where the draws in between overlap', async () => {
    const { gfx, device } = makeGpuGfx()
    await baseFrame(gfx, device)
    gfx.fillCircle(10, 10, 5, '#f00')
    gfx.fillRect(25, 5, 10, 10, '#0f0')
    gfx.fillCircle(30, 10, 5, '#00f')
    gfx.endFrame()
    expect(device.draws.map((d) => d.kind)).toEqual([
      'instancedRange',
      'arrays',
      'instancedRange',
    ])
    expect(gfx.stats.runsMerged).toBe(0)
  })

  it('does not join draws with different state', async () => {
    const { gfx, device } = makeGpuGfx()
    await baseFrame(gfx, device)
    gfx.fillCircle(10, 10, 5, '#f00')
    gfx.fillRect(100, 100, 10, 10, '#0f0')
    gfx.setBlend('lighter')
    gfx.fillCircle(30, 10, 5, '#00f')
    gfx.endFrame()
    expect(device.draws).toHaveLength(3)
  })
})

describe('GpuGfx batching, analytic clips', () => {
  it('keeps one draw when the same clip is set again between fills', async () => {
    const { gfx, device } = makeGpuGfx()
    await baseFrame(gfx, device)
    const clip = { kind: 'circle', cx: 50, cy: 50, r: 40 } as const
    gfx.setClip(clip)
    gfx.fillRect(0, 0, 5, 5, '#f00')
    gfx.setClip(clip)
    gfx.fillRect(10, 0, 5, 5, '#f00')
    gfx.endFrame()
    expect(gfx.stats.drawCalls).toBe(1)
  })

  it('keeps one draw when the clip changes, a record for each clip', async () => {
    const { gfx, device } = makeGpuGfx()
    await baseFrame(gfx, device)
    gfx.setClip({ kind: 'circle', cx: 50, cy: 50, r: 40 })
    gfx.fillRect(0, 0, 5, 5, '#f00')
    gfx.setClip({ kind: 'circle', cx: 50, cy: 50, r: 41 })
    gfx.fillRect(10, 0, 5, 5, '#f00')
    gfx.endFrame()
    expect(gfx.stats.drawCalls).toBe(1)
    // The empty record, then one for each clip.
    const records = device.dataTableUploads.at(-1)!.data
    expect(records[19]).toBe(40)
    expect(records[35]).toBe(41)
  })
})

describe('GpuGfx Phase 3, stats reflect real GL state changes', () => {
  it('counts one program switch for a single-program batch', async () => {
    const { gfx, device } = makeGpuGfx()
    await baseFrame(gfx, device)
    for (let i = 0; i < 100; i++) gfx.fillRect(i, 0, 5, 5, '#f00')
    gfx.endFrame()
    // 100 fills, one colored-tri program bind, not one per fill.
    expect(gfx.stats.programSwitches).toBe(1)
    expect(gfx.stats.drawCalls).toBe(1)
  })

  it('counts a program switch per real program flip', async () => {
    const { gfx, device } = makeGpuGfx()
    await baseFrame(gfx, device)
    // fill (coloredTri) -> circle (shape) -> fill (coloredTri): the middle run flips
    // the program, so three real switches.
    gfx.fillRect(0, 0, 5, 5, '#f00')
    gfx.fillCircle(50, 50, 5, '#0f0')
    gfx.fillRect(48, 48, 5, 5, '#00f')
    gfx.endFrame()
    expect(gfx.stats.programSwitches).toBe(3)
  })

  it('counts blend switches only when the mode actually changes', async () => {
    const { gfx, device } = makeGpuGfx()
    await baseFrame(gfx, device)
    gfx.setBlend('source-over')
    gfx.fillRect(0, 0, 5, 5, '#f00')
    gfx.fillRect(6, 0, 5, 5, '#f00') // same blend, same batch
    gfx.setBlend('lighter')
    gfx.fillRect(12, 0, 5, 5, '#0f0')
    gfx.endFrame()
    // Device starts at source-over, so only the flip to lighter is a real change.
    expect(gfx.stats.blendSwitches).toBe(1)
  })

  it('uploads the projection UBO once per frame regardless of draw count', async () => {
    const { gfx, device } = makeGpuGfx()
    await baseFrame(gfx, device)
    // The shared Frame UBO is the first uniform buffer the backend creates.
    const frameUbo = device.uniformBuffers[0]
    // Interleave programs so multiple draw runs exist, none re-upload u_proj.
    gfx.fillRect(0, 0, 5, 5, '#f00')
    gfx.fillCircle(50, 50, 5, '#0f0')
    gfx.fillRect(48, 48, 5, 5, '#00f')
    gfx.endFrame()
    expect(device.draws.length).toBe(3)
    // The projection block uploads exactly once, regardless of draw count
    // (per-run/per-object rings upload separately).
    const frameUploads = device.uniformUploads.filter(
      (u) => u.buffer === frameUbo,
    )
    expect(frameUploads).toHaveLength(1)
  })
})

describe('GpuGfx batching, drawImage / static blit', () => {
  it('drawImage of the same source coalesces into one instanced draw', async () => {
    const { gfx, device } = makeGpuGfx()
    const sprite = document.createElement('canvas')
    sprite.width = 32
    sprite.height = 32
    await baseFrame(gfx, device)
    for (let i = 0; i < 500; i++) {
      gfx.setAlpha((i % 8) / 8)
      gfx.drawImage(sprite, i, 0, 32, 32)
    }
    gfx.endFrame()
    expect(device.draws.length).toBe(1)
    expect(device.draws[0].kind).toBe('instancedRange')
    expect(device.draws[0].instanceCount).toBe(500)
  })

  it('fillRect after drawImage forces a program change -> 2 draws', async () => {
    const { gfx, device } = makeGpuGfx()
    const sprite = document.createElement('canvas')
    sprite.width = 32
    sprite.height = 32
    await baseFrame(gfx, device)
    gfx.drawImage(sprite, 0, 0, 32, 32)
    gfx.fillRect(0, 0, 5, 5, '#ff0000')
    gfx.endFrame()
    expect(device.draws.length).toBe(2)
    // Order matters, instanced (textured-quad) first, then colored-tri.
    expect(device.draws[0].kind).toBe('instancedRange')
    expect(device.draws[1].kind).toBe('arrays')
    // Programs are distinct handles.
    expect(device.draws[0].program).not.toBe(device.draws[1].program)
  })

  it('different image sources force a texture bind change -> 2 draws', async () => {
    const { gfx, device } = makeGpuGfx()
    const spriteA = document.createElement('canvas')
    spriteA.width = 32
    spriteA.height = 32
    const spriteB = document.createElement('canvas')
    spriteB.width = 32
    spriteB.height = 32
    await baseFrame(gfx, device)
    gfx.drawImage(spriteA, 0, 0, 32, 32)
    gfx.drawImage(spriteB, 32, 0, 32, 32)
    gfx.endFrame()
    expect(device.draws.length).toBe(2)
    expect(device.draws[0].texture).not.toBe(device.draws[1].texture)
  })

  it('drawImage under a rotated transform now renders (full affine)', async () => {
    const { gfx, device } = makeGpuGfx()
    const sprite = document.createElement('canvas')
    sprite.width = 32
    sprite.height = 32
    await baseFrame(gfx, device)
    // Rotate 45°, b, c non-zero.
    const cos45 = Math.cos(Math.PI / 4)
    const sin45 = Math.sin(Math.PI / 4)
    gfx.setBaseTransform(cos45, sin45, -sin45, cos45, 0, 0)
    gfx.drawImage(sprite, 0, 0, 32, 32)
    gfx.endFrame()
    // One draw (was dropped before full-affine drawImage landed).
    expect(device.draws.length).toBe(1)
    expect(device.draws[0].kind).toBe('instancedRange')
    // The rotated affine reaches the buffer: col0 = (a·dw, b·dw) = (cos45·32,
    // sin45·32), so the off-axis column component is non-zero.
    const fv = new Float32Array(device.draws[0].bufferSnapshot as ArrayBuffer)
    expect(fv[1]).toBeCloseTo(sin45 * 32) // col0.y, zero only when axis-aligned
  })
})

describe('GpuGfx frame lifecycle', () => {
  it('flush() with no pending batch is a no-op', async () => {
    const { gfx, device } = makeGpuGfx()
    await baseFrame(gfx, device)
    gfx.flush()
    gfx.endFrame()
    expect(device.draws.length).toBe(0)
  })

  it('keeps one draw across a layer-boundary flush when the state matches', async () => {
    // Stage flushes between its layers to keep painter order. Instances of one
    // stream keep their order inside a joined run, so a flush between draws of
    // the same state does not split the replay.
    const { gfx, device } = makeGpuGfx()
    await baseFrame(gfx, device)
    gfx.fillRect(0, 0, 5, 5, '#ff0000')
    gfx.flush()
    gfx.fillRect(3, 0, 5, 5, '#00ff00')
    gfx.endFrame()
    expect(device.draws.length).toBe(1)
    expect(device.draws[0].count).toBe(12)
  })

  it('stats reset each frame', async () => {
    const { gfx, device } = makeGpuGfx()
    await baseFrame(gfx, device)
    gfx.fillRect(0, 0, 5, 5, '#ff0000')
    gfx.endFrame()
    expect(gfx.stats.drawCalls).toBe(1)
    // Start a new frame, stats zero out.
    await baseFrame(gfx, device)
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
// Stroke, SDF, gradient, and tessellation coverage.
// -----------------------------------------------------------------------------

import * as SvgPathContours from '@src/stargazer/assets/SvgPathContours'
import { registerPathTessellation } from '@src/stargazer/render/gfx/PathTessellationRegistry'

describe('GpuGfx Phase 2. SDF batching', () => {
  it('T1: 400 fillCircles collapse into a single SDF instanced draw', async () => {
    const { gfx, device } = makeGpuGfx()
    await baseFrame(gfx, device)
    for (let i = 0; i < 400; i++) {
      gfx.setAlpha((i % 8) / 8)
      gfx.fillCircle(i, 0, 3, '#ffffff')
    }
    gfx.endFrame()
    expect(device.draws.length).toBe(1)
    expect(device.draws[0].kind).toBe('instancedRange')
    expect(device.draws[0].instanceCount).toBe(400)
    expect(gfx.stats.sdfInstances).toBe(400)
  })

  it('T4: fillCircle + strokeCircle coalesce into one SDF draw', async () => {
    const { gfx, device } = makeGpuGfx()
    await baseFrame(gfx, device)
    for (let i = 0; i < 50; i++) {
      gfx.fillCircle(i, 0, 3, '#ffffff')
    }
    for (let i = 0; i < 5; i++) {
      gfx.strokeCircle(i * 20, 100, 10, { color: '#41a8ff', width: 2 })
    }
    gfx.endFrame()
    // All 55 SDF instances live in the same program+blend batch.
    expect(device.draws.length).toBe(1)
    expect(device.draws[0].kind).toBe('instancedRange')
    expect(device.draws[0].instanceCount).toBe(55)
  })
})

describe('GpuGfx roundRect batching', () => {
  it('collapses many fillRoundRects into a single instanced draw', async () => {
    const { gfx, device } = makeGpuGfx()
    await baseFrame(gfx, device)
    for (let i = 0; i < 64; i++) {
      gfx.fillRoundRect(i, 0, 20, 12, 4, '#8f74e7')
    }
    gfx.endFrame()
    expect(device.draws.length).toBe(1)
    expect(device.draws[0].kind).toBe('instancedRange')
    expect(device.draws[0].instanceCount).toBe(64)
    expect(gfx.stats.roundRectInstances).toBe(64)
  })

  it('fill + stroke roundRects share one roundRect batch', async () => {
    const { gfx, device } = makeGpuGfx()
    await baseFrame(gfx, device)
    gfx.fillRoundRect(0, 0, 40, 40, 8, '#ffffff')
    gfx.strokeRoundRect(0, 0, 40, 40, 8, { color: '#41ab8e', width: 2 })
    gfx.endFrame()
    expect(device.draws.length).toBe(1)
    expect(device.draws[0].instanceCount).toBe(2)
  })

  it('a different program between roundRects breaks the batch', async () => {
    const { gfx, device } = makeGpuGfx()
    await baseFrame(gfx, device)
    // Circles/round-rects share the shape program, so a coloredTri fill (not a
    // circle) is what forces the break here.
    gfx.fillRoundRect(0, 0, 40, 40, 8, '#ffffff')
    gfx.fillRect(110, 0, 20, 12, '#ffffff') // coloredTri program -> separate batch
    gfx.fillRoundRect(120, 0, 40, 40, 8, '#ffffff')
    gfx.endFrame()
    expect(device.draws.length).toBe(3)
  })
})

describe('GpuGfx Phase 2, stroke dashStart continuity', () => {
  it('T2: 3-segment polyline accumulates dashStart across segments', async () => {
    const { gfx, device } = makeGpuGfx()
    await baseFrame(gfx, device)
    // Three horizontal segments, 100 device px each (identity base transform).
    const pts = new Float32Array([0, 0, 100, 0, 200, 0, 300, 0])
    gfx.strokePolyline(pts, 4, {
      color: '#ffffff',
      width: 4,
      dash: [10, 5],
      // Force `'round'` so we exercise the segment+disc path (the default
      // `'miter'` skips join discs to avoid AA-edge halos at shared
      // vertices).
      join: 'round',
    })
    gfx.endFrame()
    // Segments (3) + join discs (2 interior) = 5 stroke instances.
    expect(device.draws.length).toBe(1)
    expect(device.draws[0].kind).toBe('instancedRange')
    expect(device.draws[0].instanceCount).toBe(5)
    // Inspect the uploaded buffer: dashStart lives at offset 24 (bytes) of
    // each 36-byte instance record (p0.xy + p1.xy + color = 20 bytes, then
    // width (f32) + dashStart (f32) at offset 24). Segments emit first, then
    // join discs, assert dashStart on the three segments.
    const snap = device.draws[0].bufferSnapshot!
    const view = new Float32Array(snap)
    // Words per instance is 9, and dashStart is word index 6 within each instance.
    const inst0DashStart = view[0 * 9 + 6]
    const inst2DashStart = view[2 * 9 + 6]
    const inst4DashStart = view[4 * 9 + 6]
    // Instances are emitted in order: seg0, join0, seg1, join1, seg2. So the
    // three segment records are at instance indices 0, 2, 4.
    expect(inst0DashStart).toBeCloseTo(0, 5)
    expect(inst2DashStart).toBeCloseTo(100, 5)
    expect(inst4DashStart).toBeCloseTo(200, 5)
  })

  it('under lighter blend, no join discs are emitted (avoids brightening)', async () => {
    const { gfx, device } = makeGpuGfx()
    await baseFrame(gfx, device)
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
  it('T3: fillPath2D on the same Path2D twice tessellates once', async () => {
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
    // The spy captures the one manual call above. Drawing shouldn't
    // trigger any additional calls because we register directly.
    const path = new Path2D()
    registerPathTessellation(path, tess, [contour])
    const callsBefore = spy.mock.calls.length

    await baseFrame(gfx, device)
    gfx.fillPath2D(path, '#ffffff')
    gfx.fillPath2D(path, '#ffffff')
    gfx.endFrame()

    expect(spy.mock.calls.length).toBe(callsBefore) // no additional tessellations
    expect(device.draws.length).toBe(1) // both fillPath2D calls coalesce
    spy.mockRestore()
  })
})

describe('GpuGfx retained strokes', () => {
  /** A long closed contour, so its stroke is worth keeping. */
  function bigPath(): Path2D {
    const n = 400
    const contour = new Float32Array(n * 2)
    for (let i = 0; i < n; i++) {
      const a = (Math.PI * 2 * i) / n
      contour[i * 2] = 150 + Math.cos(a) * 100
      contour[i * 2 + 1] = 150 + Math.sin(a) * 100
    }
    const path = new Path2D()
    registerPathTessellation(
      path,
      SvgPathContours.tessellateContours([contour]),
      [contour],
    )
    return path
  }

  async function frame(
    gfx: GpuGfx,
    device: MockGfxDevice,
    path: Path2D,
    color: string,
    shift = 0,
  ): Promise<{ instances: number; draws: number; counted: number }> {
    await baseFrame(gfx, device)
    gfx.setBaseTransform(1, 0, 0, 1, shift, 0)
    gfx.strokePath2D(path, { color, width: 3 })
    gfx.endFrame()
    const instances = device.draws.reduce((n, d) => n + d.instanceCount, 0)
    return {
      instances,
      draws: device.draws.length,
      counted: gfx.stats.strokeInstances,
    }
  }

  it('packs a stroke that repeats on its second frame and draws it from the cache after', async () => {
    const { gfx, device } = makeGpuGfx()
    const path = bigPath()
    const first = await frame(gfx, device, path, '#ffffff')
    const second = await frame(gfx, device, path, '#ffffff')
    const third = await frame(gfx, device, path, '#ffffff')
    expect(first.counted).toBeGreaterThan(300)
    expect(second.counted).toBe(first.counted)
    expect(third.counted).toBe(0)
    expect(third.instances).toBe(first.instances)
    expect(third.draws).toBe(first.draws)
  })

  it('draws a translucent stroke in the same passes from the cache', async () => {
    const { gfx, device } = makeGpuGfx()
    const path = bigPath()
    const first = await frame(gfx, device, path, 'rgba(255, 255, 255, 0.5)')
    await frame(gfx, device, path, 'rgba(255, 255, 255, 0.5)')
    const third = await frame(gfx, device, path, 'rgba(255, 255, 255, 0.5)')
    expect(third.counted).toBe(0)
    expect(third.draws).toBe(first.draws)
    expect(third.instances).toBe(first.instances)
  })

  it('does not keep a stroke that moves every frame', async () => {
    const { gfx, device } = makeGpuGfx()
    const path = bigPath()
    for (let i = 0; i < 5; i++) {
      const r = await frame(gfx, device, path, '#ffffff', i)
      expect(r.counted).toBeGreaterThan(300)
    }
  })

  it('packs again when the color changes', async () => {
    const { gfx, device } = makeGpuGfx()
    const path = bigPath()
    await frame(gfx, device, path, '#ffffff')
    await frame(gfx, device, path, '#ffffff')
    expect((await frame(gfx, device, path, '#ffffff')).counted).toBe(0)
    expect((await frame(gfx, device, path, '#ff0000')).counted).toBeGreaterThan(
      300,
    )
  })

  /** A long open polyline, as a picture would record it. */
  const ring = (() => {
    const n = 400
    const pts = new Float32Array(n * 2)
    for (let i = 0; i < n; i++) {
      pts[i * 2] = i
      pts[i * 2 + 1] = 100 + Math.sin(i / 10) * 20
    }
    return pts
  })()

  async function polylineFrame(
    gfx: GpuGfx,
    device: MockGfxDevice,
    token: object | null,
  ): Promise<{ counted: number; draws: number; instances: number }> {
    await baseFrame(gfx, device)
    gfx.replaySource(token)
    gfx.strokePolyline(ring, 400, { color: '#ffffff', width: 3 })
    gfx.replaySource(null)
    gfx.endFrame()
    return {
      counted: gfx.stats.strokeInstances,
      draws: device.draws.length,
      instances: device.draws.reduce((n, d) => n + d.instanceCount, 0),
    }
  }

  it('keeps a replayed polyline whose recording is unchanged', async () => {
    const { gfx, device } = makeGpuGfx()
    const token = {}
    const first = await polylineFrame(gfx, device, token)
    await polylineFrame(gfx, device, token)
    const third = await polylineFrame(gfx, device, token)
    expect(first.counted).toBeGreaterThan(300)
    expect(third.counted).toBe(0)
    expect(third.instances).toBe(first.instances)
    expect(third.draws).toBe(first.draws)
  })

  it('never keeps a polyline drawn outside a replay', async () => {
    const { gfx, device } = makeGpuGfx()
    for (let i = 0; i < 4; i++) {
      expect((await polylineFrame(gfx, device, null)).counted).toBeGreaterThan(
        300,
      )
    }
  })

  it('packs again for a new recording', async () => {
    const { gfx, device } = makeGpuGfx()
    const token = {}
    await polylineFrame(gfx, device, token)
    await polylineFrame(gfx, device, token)
    expect((await polylineFrame(gfx, device, token)).counted).toBe(0)
    expect((await polylineFrame(gfx, device, {})).counted).toBeGreaterThan(300)
  })

  it('frees a kept stroke once it goes undrawn', async () => {
    const { gfx, device } = makeGpuGfx()
    const path = bigPath()
    await frame(gfx, device, path, '#ffffff')
    await frame(gfx, device, path, '#ffffff')
    expect(gfx.cacheStats()[0].entries).toBe(1)
    for (let i = 0; i < 125; i++) {
      await baseFrame(gfx, device)
      gfx.endFrame()
    }
    expect(gfx.cacheStats()[0].entries).toBe(0)
    expect(gfx.cacheStats()[0].evicted).toBe(1)
  })

  it('lets streamed runs merge across a kept stroke they do not touch', async () => {
    const { gfx, device } = makeGpuGfx()
    const path = bigPath()
    const draw = async (): Promise<number> => {
      await baseFrame(gfx, device)
      gfx.fillRect(0, 0, 10, 10, '#ff0000')
      gfx.setBaseTransform(1, 0, 0, 1, 0, 0)
      gfx.strokePath2D(path, { color: '#ffffff', width: 3 })
      gfx.fillRect(390, 290, 10, 10, '#ff0000')
      gfx.endFrame()
      return device.draws.length
    }
    await draw()
    await draw()
    // The two rects lie outside the ring and join into one draw, with the
    // kept stroke as the second.
    expect(await draw()).toBe(2)
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
    width: number
    height: number
    constructor(width: number, height: number) {
      this.width = width
      this.height = height
    }
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

  it('T8: two distinct tagged particle sprites coalesce into ONE instanced draw', async () => {
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
    await baseFrame(gfx, device)
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

  it('small untagged canvases share the label page, so they draw together', async () => {
    const { gfx, device } = makeGpuGfx()
    const a = document.createElement('canvas')
    a.width = 64
    a.height = 64
    const b = document.createElement('canvas')
    b.width = 64
    b.height = 64
    await baseFrame(gfx, device)
    gfx.drawImage(a, 0, 0, 64, 64)
    gfx.drawImage(b, 64, 0, 64, 64)
    gfx.endFrame()
    expect(device.draws.length).toBe(1)
    // One raster uploaded for each source.
    expect(device.subImageUploads.length).toBe(2)
  })

  it('untagged canvases too large for a page slot keep their own textures', async () => {
    const { gfx, device } = makeGpuGfx()
    const a = document.createElement('canvas')
    a.width = 1024
    a.height = 1024
    const b = document.createElement('canvas')
    b.width = 1024
    b.height = 1024
    await baseFrame(gfx, device)
    gfx.drawImage(a, 0, 0, 1024, 1024)
    gfx.drawImage(b, 1024, 0, 1024, 1024)
    gfx.endFrame()
    expect(device.draws.length).toBe(2)
    expect(device.subImageUploads.length).toBe(0)
  })

  it('draws one image at one size from one raster, however often it is drawn', async () => {
    const { gfx, device } = makeGpuGfx()
    const a = document.createElement('canvas')
    a.width = 16
    a.height = 16
    await baseFrame(gfx, device)
    for (let i = 0; i < 5; i++) {
      gfx.drawImage(a, i * 100, 0, 96, 96, { smoothing: false })
    }
    gfx.endFrame()
    expect(device.subImageUploads.length).toBe(1)
    expect(device.draws.length).toBe(1)
  })
})

describe('GpuGfx Phase 2. EpicenterNode-shape frame', () => {
  it('T5: dashed ring + solid ring + fill disc coalesce into ONE SDF batch', async () => {
    const { gfx, device } = makeGpuGfx()
    await baseFrame(gfx, device)
    // Rings + fill disc: all SDF instances, same batch.
    gfx.strokeCircle(50, 50, 20, { color: '#41a8ff', width: 2, dash: [4, 4] })
    gfx.strokeCircle(50, 50, 30, { color: '#41a8ff', width: 1 })
    gfx.fillCircle(50, 50, 4, '#ffffff')
    gfx.strokeCircle(50, 50, 45, { color: '#41a8ff', width: 1 })
    gfx.endFrame()
    expect(device.draws.length).toBe(1)
    expect(device.draws[0].kind).toBe('instancedRange')
    expect(device.draws[0].instanceCount).toBe(4)
  })

  // fillCircleRadialGradient has no mock-device test: its LUT construction
  // goes through OffscreenCanvas.getContext('2d'), which returns null under
  // happy-dom. Verifying it needs a real browser.
})
