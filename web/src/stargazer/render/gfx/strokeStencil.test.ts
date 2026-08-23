import { describe, expect, it } from 'vitest'
import { GpuGfx } from './GpuGfx'
import { MockGfxDevice, type DrawRecord } from './webgl2/mockGfxDevice'
import { pipelineKey } from './pipelineKey'
import type { PipelineDesc } from './GfxDevice'

/**
 * A stencil-backed surface, as the primary stage builds. `stencil: false`
 * models a secondary surface (a `Viewport2DNode`) that has none.
 */
async function makeGfx(stencil = true): Promise<{
  gfx: GpuGfx
  device: MockGfxDevice
}> {
  const canvas = document.createElement('canvas')
  canvas.width = 400
  canvas.height = 300
  const device = new MockGfxDevice()
  const gfx = new GpuGfx(canvas, device, { stencil })
  await gfx.whenReady
  device.reset()
  gfx.beginFrame({
    clearColor: '#000000',
    transparent: false,
    pixelW: 400,
    pixelH: 300,
  })
  gfx.setBaseTransform(1, 0, 0, 1, 0, 0)
  gfx.setAlpha(1)
  return { gfx, device }
}

const ZIGZAG = [10, 10, 60, 40, 110, 10, 160, 40]

/**
 * Whether a draw is doing real deduplication. On a stencil-backed target every
 * pipeline declares a stencil state so its format matches the attachment, so
 * "has a stencil state" is not the question, "does it test and write" is.
 */
function isDedup(d: DrawRecord): boolean {
  return d.stencil?.front.passOp === 'increment-clamp'
}

/** Whether a draw is the pass that zeroes the bits again. */
function isReset(d: DrawRecord): boolean {
  return d.stencil?.front.passOp === 'zero'
}

/**
 * The stroke uniform block. Core and fringe run the same pipeline and differ
 * only by this, so it is what tells the two apart.
 */
function uniform(d: DrawRecord): unknown {
  return d.bindGroups.find((g) => g.group === 1)?.bindGroup
}

function strokeDraws(device: MockGfxDevice): DrawRecord[] {
  // Every stroke goes through the one instanced program with no texture.
  return device.draws.filter((d) => d.kind === 'instancedRange')
}

describe('translucent strokes deduplicate through the stencil', () => {
  it('records a draw pass and a reset pass over the same instances', async () => {
    const { gfx, device } = await makeGfx()
    gfx.setAlpha(0.4)
    gfx.strokePolyline(ZIGZAG, 4, { color: '#ffffff', width: 8 })
    gfx.endFrame()

    const draws = strokeDraws(device)
    expect(draws).toHaveLength(3)

    const [core, fringe, reset] = draws
    // All three replay the identical buffer range: no second upload, no second
    // emit, just the same bytes under different state.
    for (const d of [fringe, reset]) {
      expect(d.vertexBuffers[1].offset).toBe(core.vertexBuffers[1].offset)
      expect(d.instanceCount).toBe(core.instanceCount)
    }

    // Cores first, so a joint's solid body claims its pixels before any
    // neighbour's antialiased rim can. Both paint under the same test.
    expect(isDedup(core)).toBe(true)
    expect(isDedup(fringe)).toBe(true)
    expect(core.colorWrite).toBe(true)
    expect(fringe.colorWrite).toBe(true)
    expect(core.stencil?.front.compare).toBe('equal')
    expect(core.stencil?.reference).toBe(0)
    // Only the uniform separates them.
    expect(uniform(core)).not.toBe(uniform(fringe))

    // The reset only zeroes the bits, it must not repaint.
    expect(reset.colorWrite).toBe(false)
    expect(reset.stencil?.front.compare).toBe('always')
    expect(reset.stencil?.front.passOp).toBe('zero')
  })

  it('leaves an opaque stroke on the plain batched path', async () => {
    const { gfx, device } = await makeGfx()
    gfx.setAlpha(1)
    gfx.strokePolyline(ZIGZAG, 4, { color: '#ffffff', width: 8 })
    gfx.endFrame()

    const draws = strokeDraws(device)
    expect(draws).toHaveLength(1)
    expect(isDedup(draws[0])).toBe(false)
    // Inert: declares the format the pass needs, writes nothing.
    expect(draws[0].stencil?.writeMask).toBe(0)
  })

  it('reads alpha from the color as well as the state stack', async () => {
    const { gfx, device } = await makeGfx()
    gfx.setAlpha(1)
    gfx.strokePolyline(ZIGZAG, 4, { color: 'rgba(255,255,255,0.5)', width: 8 })
    gfx.endFrame()
    expect(strokeDraws(device)).toHaveLength(3)
  })

  it('leaves a single-segment stroke alone at any alpha', async () => {
    const { gfx, device } = await makeGfx()
    gfx.setAlpha(0.4)
    gfx.strokeLine(0, 0, 50, 50, { color: '#ffffff', width: 8 })
    gfx.endFrame()

    const draws = strokeDraws(device)
    expect(draws).toHaveLength(1)
    expect(isDedup(draws[0])).toBe(false)
  })

  it('gives two translucent strokes a group each, so a crossing still blends', async () => {
    const { gfx, device } = await makeGfx()
    gfx.setAlpha(0.4)
    gfx.strokePolyline(ZIGZAG, 4, { color: '#ffffff', width: 8 })
    gfx.strokePolyline(ZIGZAG, 4, { color: '#ff0000', width: 8 })
    gfx.endFrame()

    // Two independent groups, not one merged batch: deduplication is scoped to
    // a stroke, so where two distinct strokes overlap they must still composite
    // twice.
    const draws = strokeDraws(device)
    expect(draws).toHaveLength(6)
    expect(draws.map((d) => d.colorWrite)).toEqual([
      true,
      true,
      false,
      true,
      true,
      false,
    ])
  })

  it('falls back to the plain path on a surface with no stencil', async () => {
    const { gfx, device } = await makeGfx(false)
    gfx.setAlpha(0.4)
    gfx.strokePolyline(ZIGZAG, 4, { color: '#ffffff', width: 8 })
    gfx.endFrame()

    const draws = strokeDraws(device)
    expect(draws).toHaveLength(1)
    // No attachment, so no stencil state is declared at all.
    expect(draws[0].stencil).toBeNull()
  })

  it('seals into complete groups when a ring overflow splits a stroke', async () => {
    // The ring holds ~29k stroke instances. A stroke longer than that submits
    // mid-flight, which wipes the command list. Without sealing first, the
    // draw runs recorded so far would replay with no reset behind them and
    // leave the stencil set for the rest of the frame, silently rejecting
    // every later stroke over those pixels.
    const { gfx, device } = await makeGfx()
    const points = 40_000
    const pts = new Float32Array(points * 2)
    for (let i = 0; i < points; i++) {
      pts[i * 2] = (i % 200) * 2
      pts[i * 2 + 1] = i % 2 === 0 ? 10 : 40
    }
    gfx.setAlpha(0.4)
    gfx.strokePolyline(pts, points, { color: '#ffffff', width: 8 })
    gfx.endFrame()

    const draws = strokeDraws(device)
    // More than one group, so the split really happened.
    expect(draws.length).toBeGreaterThan(3)
    const painted = draws.filter((d) => d.colorWrite)
    const reset = draws.filter((d) => !d.colorWrite)
    // Two painting passes (core, fringe) per reset.
    expect(painted.length).toBe(reset.length * 2)
    expect(reset.length).toBeGreaterThan(1)
    for (const d of painted) expect(isDedup(d)).toBe(true)
    for (const r of reset) expect(isReset(r)).toBe(true)

    // Every painted range is answered by a reset over the same instances, so no
    // pixel is left with its stencil bit set for the rest of the frame. Counted
    // rather than set-compared: the ring restarts at offset 0 after the
    // overflow, so both groups legitimately share a starting offset.
    const tally = (ds: DrawRecord[]): Map<number, number> => {
      const m = new Map<number, number>()
      for (const d of ds) {
        const k = d.vertexBuffers[1].offset
        m.set(k, (m.get(k) ?? 0) + 1)
      }
      return m
    }
    const paintedBy = tally(painted)
    for (const [offset, resets] of tally(reset)) {
      expect(paintedBy.get(offset)).toBe(resets * 2)
    }
  })

  it('clears the stencil once at the start of the frame', async () => {
    const { gfx, device } = await makeGfx()
    gfx.endFrame()
    const pass = device.passes.at(-1)
    expect(pass?.desc.stencil?.loadOp).toBe('clear')
    expect(pass?.desc.stencil?.clearValue).toBe(0)
  })
})

describe('pipelineKey', () => {
  const base: PipelineDesc = {
    shader: {} as PipelineDesc['shader'],
    vertexLayout: [],
    bindGroupLayouts: [],
    color: { format: 'linear', blend: 'source-over' },
    depth: null,
    cull: 'none',
    frontFace: 'ccw',
    primitive: 'triangle-list',
    samples: 1,
  }

  it('separates the draw and reset stencil states', () => {
    const draw = pipelineKey({
      ...base,
      stencil: {
        front: { compare: 'equal', passOp: 'increment-clamp' },
        reference: 0,
      },
    })
    const reset = pipelineKey({
      ...base,
      color: { format: 'linear', blend: 'source-over', write: false },
      stencil: { front: { compare: 'always', passOp: 'zero' }, reference: 0 },
    })
    expect(draw).not.toBe(reset)
    expect(draw).not.toBe(pipelineKey(base))
  })

  it('separates two pipelines differing only in color write', () => {
    const on = pipelineKey(base)
    const off = pipelineKey({
      ...base,
      color: { format: 'linear', blend: 'source-over', write: false },
    })
    expect(on).not.toBe(off)
  })
})
