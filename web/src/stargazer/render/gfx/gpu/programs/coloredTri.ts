// Colored-tri program: flat-color fills (`fillRect`, `fillConvexPoly`,
// `fillPath2D`, `fillPolyLinearGradient`). The busiest program: it's the only
// one with a clip mask (batch key includes it) and the only one the debug
// render modes (`'polygons'`, `'overdraw'`, `'batch-color'`) touch. `GpuGfx`
// keeps the `'polygons'`-mode outline emission (it needs `StrokeProgram`, a
// different program) and, for `fillPath2D`, the tessellation-registry lookup;
// everything else — the transform math, mask UVs, and vertex packing for each
// fill shape — lives here alongside the shader/VAO/stream plumbing and the
// debug-mode uniforms/blend override inside `flush`.

import type { AttribBinding, GfxDevice, Program, Vao } from '../../GfxDevice'
import type { BitmapMask } from '../../../../assets/BitmapMask'
import type { GeometryHandle } from '../../GeometryHandle'
import { parseColor } from '../../parseColor'
import { RingStream } from '../RingStream'
import { hsvToRgb, packColor, writeColoredVert } from '../packing'
import {
  COLORED_TRI_BUFFER_BYTES,
  COLORED_TRI_STRIDE,
  COLORED_TRI_WORDS,
  LOC_COLORED_COLOR,
  LOC_COLORED_POS,
  LOC_COLORED_UV,
  RING_SIZE,
} from '../batchLayout'
import type { GpuBatchContext } from '../GpuBatchContext'
import type { GpuProgram } from '../GpuProgram'
import earcut from 'earcut'
import coloredTriVertSrc from '../webgl2/shaders/coloredTri.vert.glsl?raw'
import coloredTriFragSrc from '../webgl2/shaders/coloredTri.frag.glsl?raw'

export class ColoredTriProgram implements GpuProgram {
  readonly kind = 'coloredTri' as const

  #program!: Program
  #stream!: RingStream
  #vaos: Vao[] = new Array(RING_SIZE)

  init(device: GfxDevice, ctx: GpuBatchContext): void {
    this.#program = device.createProgram({
      vertexSrc: coloredTriVertSrc,
      fragmentSrc: coloredTriFragSrc,
      attribs: {
        a_pos: LOC_COLORED_POS,
        a_color: LOC_COLORED_COLOR,
        a_uv: LOC_COLORED_UV,
      },
    })
    this.#stream = new RingStream(
      device,
      COLORED_TRI_BUFFER_BYTES,
      COLORED_TRI_STRIDE,
      'coloredTri',
    )
    this.#vaos = new Array(RING_SIZE)
    for (let slot = 0; slot < RING_SIZE; slot++) {
      const attribs: AttribBinding[] = [
        {
          buffer: this.#stream.buffers[slot],
          location: LOC_COLORED_POS,
          size: 2,
          type: 'float',
          normalized: false,
          offset: 0,
          stride: COLORED_TRI_STRIDE,
          divisor: 0,
        },
        {
          buffer: this.#stream.buffers[slot],
          location: LOC_COLORED_COLOR,
          size: 4,
          type: 'unorm8',
          normalized: true,
          offset: 8,
          stride: COLORED_TRI_STRIDE,
          divisor: 0,
        },
        {
          buffer: this.#stream.buffers[slot],
          location: LOC_COLORED_UV,
          size: 2,
          type: 'float',
          normalized: false,
          offset: 12,
          stride: COLORED_TRI_STRIDE,
          divisor: 0,
        },
      ]
      this.#vaos[slot] = device.createVao(this.#program, attribs)
    }
    void ctx // no shared buffer needed (coloredTri has no unit-quad attribute)
  }

  resetSlot(slot: number): void {
    this.#stream.reset(slot)
  }

  /** Begin (or continue) the `coloredTri` batch for the current clip mask. */
  begin(ctx: GpuBatchContext): void {
    ctx.beginBatch('coloredTri', { clipMask: ctx.stateStack.getClipMask() })
  }

  reserve(slot: number, wordsNeeded: number, vertCount: number): number {
    return this.#stream.reserve(slot, wordsNeeded, vertCount)
  }

  commit(slot: number, wordsAdded: number, vertCount: number): void {
    this.#stream.commit(slot, wordsAdded, vertCount)
  }

  get floatView(): Float32Array {
    return this.#stream.floatView
  }

  get uintView(): Uint32Array {
    return this.#stream.uintView
  }

  /** `Gfx2D.fillRect`. */
  fillRect(
    ctx: GpuBatchContext,
    x: number,
    y: number,
    w: number,
    h: number,
    color: string,
  ): void {
    const packedColor = packColor(color, ctx.stateStack.getAlpha())
    this.begin(ctx)
    const slot = ctx.curSlot
    // 6 verts × 5 words each.
    const wordsNeeded = 6 * COLORED_TRI_WORDS
    const off = this.#stream.reserve(slot, wordsNeeded, 6)
    if (off < 0) return
    ctx.txStack.read(ctx.txOut)
    const t = ctx.txOut
    // Four local corners of the rect.
    const x0 = x
    const y0 = y
    const x1 = x + w
    const y1 = y + h
    // Transformed corners (device px).
    const ax = t.a * x0 + t.c * y0 + t.e
    const ay = t.b * x0 + t.d * y0 + t.f
    const bx = t.a * x1 + t.c * y0 + t.e
    const by = t.b * x1 + t.d * y0 + t.f
    const cx = t.a * x1 + t.c * y1 + t.e
    const cy = t.b * x1 + t.d * y1 + t.f
    const dx = t.a * x0 + t.c * y1 + t.e
    const dy = t.b * x0 + t.d * y1 + t.f
    // Mask UVs: computed against LOCAL (pre-transform) x0/y0/x1/y1, the
    // mask's worldRect lives in world/local space, NOT device pixels. Under
    // the coloredTri shader `v_uv` is only sampled when `u_clipEnabled == 1`;
    // when no clip is active, uv=(0,0) placeholders are ignored.
    const mask = ctx.curClipMask
    let uA = 0,
      vA = 0,
      uB = 0,
      vB = 0,
      uC = 0,
      vC = 0,
      uD = 0,
      vD = 0
    if (mask) {
      const r = mask.worldRect
      const invW = 1 / r.width
      const invH = 1 / r.height
      uA = (x0 - r.x) * invW
      vA = (y0 - r.y) * invH
      uB = (x1 - r.x) * invW
      vB = (y0 - r.y) * invH
      uC = (x1 - r.x) * invW
      vC = (y1 - r.y) * invH
      uD = (x0 - r.x) * invW
      vD = (y1 - r.y) * invH
    }
    const f = this.#stream.floatView
    const u = this.#stream.uintView
    // Tri 1: A, B, C
    writeColoredVert(f, u, off + 0, ax, ay, packedColor, uA, vA)
    writeColoredVert(f, u, off + COLORED_TRI_WORDS, bx, by, packedColor, uB, vB)
    writeColoredVert(
      f,
      u,
      off + COLORED_TRI_WORDS * 2,
      cx,
      cy,
      packedColor,
      uC,
      vC,
    )
    // Tri 2: A, C, D
    writeColoredVert(
      f,
      u,
      off + COLORED_TRI_WORDS * 3,
      ax,
      ay,
      packedColor,
      uA,
      vA,
    )
    writeColoredVert(
      f,
      u,
      off + COLORED_TRI_WORDS * 4,
      cx,
      cy,
      packedColor,
      uC,
      vC,
    )
    writeColoredVert(
      f,
      u,
      off + COLORED_TRI_WORDS * 5,
      dx,
      dy,
      packedColor,
      uD,
      vD,
    )
    this.#stream.commit(slot, wordsNeeded, 6)
  }

  /** `Gfx2D.fillConvexPoly`. */
  fillConvexPoly(
    ctx: GpuBatchContext,
    pts: ArrayLike<number>,
    count: number,
    color: string,
  ): void {
    if (count < 3) return
    const packedColor = packColor(color, ctx.stateStack.getAlpha())
    this.begin(ctx)
    const slot = ctx.curSlot
    const vertCount = (count - 2) * 3
    const wordsNeeded = vertCount * COLORED_TRI_WORDS
    const off = this.#stream.reserve(slot, wordsNeeded, vertCount)
    if (off < 0) return
    ctx.txStack.read(ctx.txOut)
    const t = ctx.txOut
    const mask = ctx.curClipMask
    const mrx = mask ? mask.worldRect.x : 0
    const mry = mask ? mask.worldRect.y : 0
    const invMW = mask ? 1 / mask.worldRect.width : 0
    const invMH = mask ? 1 / mask.worldRect.height : 0
    const f = this.#stream.floatView
    const u = this.#stream.uintView
    const l0x = pts[0]
    const l0y = pts[1]
    const p0x = t.a * l0x + t.c * l0y + t.e
    const p0y = t.b * l0x + t.d * l0y + t.f
    const u0 = mask ? (l0x - mrx) * invMW : 0
    const v0 = mask ? (l0y - mry) * invMH : 0
    let cursor = off
    for (let i = 1; i < count - 1; i++) {
      const l1x = pts[i * 2]
      const l1y = pts[i * 2 + 1]
      const l2x = pts[(i + 1) * 2]
      const l2y = pts[(i + 1) * 2 + 1]
      const p1x = t.a * l1x + t.c * l1y + t.e
      const p1y = t.b * l1x + t.d * l1y + t.f
      const p2x = t.a * l2x + t.c * l2y + t.e
      const p2y = t.b * l2x + t.d * l2y + t.f
      const u1 = mask ? (l1x - mrx) * invMW : 0
      const v1 = mask ? (l1y - mry) * invMH : 0
      const u2 = mask ? (l2x - mrx) * invMW : 0
      const v2 = mask ? (l2y - mry) * invMH : 0
      writeColoredVert(f, u, cursor, p0x, p0y, packedColor, u0, v0)
      writeColoredVert(
        f,
        u,
        cursor + COLORED_TRI_WORDS,
        p1x,
        p1y,
        packedColor,
        u1,
        v1,
      )
      writeColoredVert(
        f,
        u,
        cursor + 2 * COLORED_TRI_WORDS,
        p2x,
        p2y,
        packedColor,
        u2,
        v2,
      )
      cursor += 3 * COLORED_TRI_WORDS
    }
    this.#stream.commit(slot, wordsNeeded, vertCount)
  }

  /** `Gfx2D.fillPath2D`'s emission tail, once a tessellation is resolved. */
  fillTessellation(
    ctx: GpuBatchContext,
    geo: GeometryHandle,
    color: string,
  ): void {
    const packedColor = packColor(color, ctx.stateStack.getAlpha())
    this.begin(ctx)
    const slot = ctx.curSlot
    const triCount = geo.indices.length / 3
    const vertCount = geo.indices.length
    const wordsNeeded = vertCount * COLORED_TRI_WORDS
    const off = this.#stream.reserve(slot, wordsNeeded, vertCount)
    if (off < 0) return
    ctx.txStack.read(ctx.txOut)
    const t = ctx.txOut
    const mask = ctx.curClipMask
    const mrx = mask ? mask.worldRect.x : 0
    const mry = mask ? mask.worldRect.y : 0
    const invMW = mask ? 1 / mask.worldRect.width : 0
    const invMH = mask ? 1 / mask.worldRect.height : 0
    const f = this.#stream.floatView
    const u = this.#stream.uintView
    const verts = geo.vertices
    const idx = geo.indices
    let cursor = off
    for (let i = 0; i < triCount; i++) {
      const i0 = idx[i * 3]
      const i1 = idx[i * 3 + 1]
      const i2 = idx[i * 3 + 2]
      const v0x = verts[i0 * 2]
      const v0y = verts[i0 * 2 + 1]
      const v1x = verts[i1 * 2]
      const v1y = verts[i1 * 2 + 1]
      const v2x = verts[i2 * 2]
      const v2y = verts[i2 * 2 + 1]
      const u0 = mask ? (v0x - mrx) * invMW : 0
      const v0v = mask ? (v0y - mry) * invMH : 0
      const u1 = mask ? (v1x - mrx) * invMW : 0
      const v1v = mask ? (v1y - mry) * invMH : 0
      const u2 = mask ? (v2x - mrx) * invMW : 0
      const v2v = mask ? (v2y - mry) * invMH : 0
      writeColoredVert(
        f,
        u,
        cursor,
        t.a * v0x + t.c * v0y + t.e,
        t.b * v0x + t.d * v0y + t.f,
        packedColor,
        u0,
        v0v,
      )
      writeColoredVert(
        f,
        u,
        cursor + COLORED_TRI_WORDS,
        t.a * v1x + t.c * v1y + t.e,
        t.b * v1x + t.d * v1y + t.f,
        packedColor,
        u1,
        v1v,
      )
      writeColoredVert(
        f,
        u,
        cursor + 2 * COLORED_TRI_WORDS,
        t.a * v2x + t.c * v2y + t.e,
        t.b * v2x + t.d * v2y + t.f,
        packedColor,
        u2,
        v2v,
      )
      cursor += 3 * COLORED_TRI_WORDS
    }
    this.#stream.commit(slot, wordsNeeded, vertCount)
  }

  /**
   * `Gfx2D.fillPolyLinearGradient`. Non-convex polygons (motion-trail
   * teardrops) must ear-clip, a fan triangulation on a concave outline emits
   * overlapping triangles that read as visible artefacts.
   */
  fillPolyLinearGradient(
    ctx: GpuBatchContext,
    pts: ArrayLike<number>,
    count: number,
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    colorStart: string,
    colorEnd: string,
  ): void {
    if (count < 3) return
    const flat: number[] = new Array(count * 2)
    for (let i = 0; i < count * 2; i++) flat[i] = pts[i]
    const indices = earcut(flat)
    const triCount = (indices.length / 3) | 0
    if (triCount === 0) return
    this.begin(ctx)
    const slot = ctx.curSlot
    const vertCount = triCount * 3
    const wordsNeeded = vertCount * COLORED_TRI_WORDS
    const off = this.#stream.reserve(slot, wordsNeeded, vertCount)
    if (off < 0) return
    const cStart = parseColor(colorStart)
    const cEnd = parseColor(colorEnd)
    const stateAlpha = ctx.stateStack.getAlpha()
    ctx.txStack.read(ctx.txOut)
    const t = ctx.txOut
    // Gradient axis is in local (pre-transform) space.
    const ax = x1 - x0
    const ay = y1 - y0
    const axLen2 = ax * ax + ay * ay
    const invAxLen2 = axLen2 > 0 ? 1 / axLen2 : 0
    const packAt = (lx: number, ly: number): number => {
      const dx = lx - x0
      const dy = ly - y0
      let s = (dx * ax + dy * ay) * invAxLen2
      if (s < 0) s = 0
      else if (s > 1) s = 1
      const inv = 1 - s
      const r = cStart.r * inv + cEnd.r * s
      const g = cStart.g * inv + cEnd.g * s
      const b = cStart.b * inv + cEnd.b * s
      const a = (cStart.a * inv + cEnd.a * s) * stateAlpha
      const rb = Math.max(0, Math.min(255, Math.round(r * a * 255)))
      const gb = Math.max(0, Math.min(255, Math.round(g * a * 255)))
      const bb = Math.max(0, Math.min(255, Math.round(b * a * 255)))
      const ab = Math.max(0, Math.min(255, Math.round(a * 255)))
      return (ab << 24) | (bb << 16) | (gb << 8) | rb
    }
    const mask = ctx.curClipMask
    const mrx = mask ? mask.worldRect.x : 0
    const mry = mask ? mask.worldRect.y : 0
    const invMW = mask ? 1 / mask.worldRect.width : 0
    const invMH = mask ? 1 / mask.worldRect.height : 0
    const f = this.#stream.floatView
    const u = this.#stream.uintView
    let cursor = off
    for (let i = 0; i < triCount; i++) {
      const i0 = indices[i * 3]
      const i1 = indices[i * 3 + 1]
      const i2 = indices[i * 3 + 2]
      const l0x = pts[i0 * 2]
      const l0y = pts[i0 * 2 + 1]
      const l1x = pts[i1 * 2]
      const l1y = pts[i1 * 2 + 1]
      const l2x = pts[i2 * 2]
      const l2y = pts[i2 * 2 + 1]
      const c0 = packAt(l0x, l0y)
      const c1 = packAt(l1x, l1y)
      const c2 = packAt(l2x, l2y)
      const p0x = t.a * l0x + t.c * l0y + t.e
      const p0y = t.b * l0x + t.d * l0y + t.f
      const p1x = t.a * l1x + t.c * l1y + t.e
      const p1y = t.b * l1x + t.d * l1y + t.f
      const p2x = t.a * l2x + t.c * l2y + t.e
      const p2y = t.b * l2x + t.d * l2y + t.f
      const mu0 = mask ? (l0x - mrx) * invMW : 0
      const mv0 = mask ? (l0y - mry) * invMH : 0
      const mu1 = mask ? (l1x - mrx) * invMW : 0
      const mv1 = mask ? (l1y - mry) * invMH : 0
      const mu2 = mask ? (l2x - mrx) * invMW : 0
      const mv2 = mask ? (l2y - mry) * invMH : 0
      writeColoredVert(f, u, cursor, p0x, p0y, c0, mu0, mv0)
      writeColoredVert(f, u, cursor + COLORED_TRI_WORDS, p1x, p1y, c1, mu1, mv1)
      writeColoredVert(
        f,
        u,
        cursor + 2 * COLORED_TRI_WORDS,
        p2x,
        p2y,
        c2,
        mu2,
        mv2,
      )
      cursor += 3 * COLORED_TRI_WORDS
    }
    this.#stream.commit(slot, wordsNeeded, vertCount)
  }

  flush(ctx: GpuBatchContext): void {
    const slot = ctx.curSlot
    const words = this.#stream.pendingWords[slot]
    if (words === 0) return
    const vertCount = this.#stream.pendingVerts[slot]
    ctx.device.updateBufferSubData(
      this.#stream.buffers[slot],
      0,
      this.#stream.floatView,
      0,
      words * 4,
    )
    ctx.device.useProgram(this.#program)
    ctx.stats.programSwitches++
    ctx.device.setUniformMat3(this.#program, 'u_proj', ctx.projMat)
    // Clip-mask state. `u_clipEnabled = 1` triggers the fragment sampler
    // path; bind the mask to unit 1 (unit 0 stays reserved for
    // texturedQuad's atlas so a program flip doesn't clobber it).
    this.#bindClipMask(ctx, ctx.curClipMask)
    // Debug render-mode uniforms + blend override.
    // Modes 3 (clip-mask) and 'polygons' don't touch the coloredTri shader
    //, the former is an end-of-frame overlay via DebugController; the
    // latter emits extra strokes at fill sites.
    let debugModeInt = 0
    if (ctx.curDebugMode === 'overdraw') debugModeInt = 1
    else if (ctx.curDebugMode === 'batch-color') debugModeInt = 2
    ctx.device.setUniform1i(this.#program, 'u_debugMode', debugModeInt)
    if (debugModeInt === 2) {
      // Golden-ratio hue cycling, visually distinct neighbouring batches.
      const h = ((ctx.debugBatchCounter * 0.61803398875) % 1) * 6
      const [r, g, b] = hsvToRgb(h, 0.75, 1)
      // Premultiplied output, alpha is baked into rgb.
      ctx.device.setUniform4f(
        this.#program,
        'u_debugColor',
        r * 0.8,
        g * 0.8,
        b * 0.8,
        0.8,
      )
    } else {
      // Silent zero, the shader ignores when mode != 2, but avoid
      // leaving a stale value from a prior batch.
      ctx.device.setUniform4f(this.#program, 'u_debugColor', 0, 0, 0, 0)
    }
    ctx.debugBatchCounter++
    // Overdraw forces additive blend, otherwise `source-over` would
    // paint an opaque red instead of the intended accumulating heatmap.
    if (debugModeInt === 1) {
      ctx.device.setBlend('lighter')
    }
    ctx.device.bindVao(this.#vaos[slot])
    ctx.device.drawArrays(0, vertCount)
    ctx.stats.drawCalls++
    this.#stream.commitFlushed(slot)
  }

  #bindClipMask(ctx: GpuBatchContext, mask: BitmapMask | null): void {
    if (!mask) {
      ctx.device.setUniform1i(this.#program, 'u_clipEnabled', 0)
      return
    }
    const maskTex = ctx.textureManager.ensureMaskTexture(mask)
    if (!maskTex) {
      ctx.device.setUniform1i(this.#program, 'u_clipEnabled', 0)
      return
    }
    ctx.device.setUniform1i(this.#program, 'u_clipEnabled', 1)
    ctx.device.setUniformTexture(this.#program, 'u_clipTex', maskTex, 1)
    ctx.stats.textureBinds++
  }
}
