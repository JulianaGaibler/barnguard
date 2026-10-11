// Colored-tri program: flat-color fills (`fillRect`, `fillConvexPoly`,
// `fillPath2D`, `fillPolyLinearGradient`). The busiest program: it's the only
// one with a clip mask (batch key includes it) and the only one the debug
// render modes (`'polygons'`, `'overdraw'`, `'batch-color'`) touch. `GpuGfx`
// keeps the `'polygons'`-mode outline emission (it needs `StrokeProgram`, a
// different program) and, for `fillPath2D`, the tessellation-registry lookup.
// Everything else, the transform math, mask UVs, and vertex packing for each
// fill shape, lives here alongside the shader/VAO/stream plumbing and the
// debug-mode uniforms/blend override inside `flush`.

import type { GeometryHandle, GpuGeometry } from '../GeometryHandle'
import { parseColor, type RGBA } from '../parseColor'
import { RingStream } from '../RingStream'
import {
  gradientAxis,
  hsvToRgb,
  packRgba,
  resolvePaint,
  writeColoredVert,
} from '../packing'
import {
  COLORED_TRI_BUFFER_BYTES,
  COLORED_TRI_STRIDE,
  COLORED_TRI_WORDS,
  DRAWPARAMS_UBO_BINDING,
  LOC_COLORED_COLOR,
  LOC_COLORED_POS,
  LOC_COLORED_UV,
  MODELCOLOR_UBO_BINDING,
} from '../batchLayout'
import type {
  DrawRun,
  GpuBatchContext,
  ResolvedGradientPaint,
} from '../GpuBatchContext'
import type { GpuProgram } from '../GpuProgram'
import type { TransformOut } from '../TransformStack'
import type {
  BindGroup,
  BindGroupLayout,
  GfxDevice,
  Pipeline,
  ShaderModule,
  Texture,
  VertexBufferLayout,
} from '../GfxDevice'
import { UboRing, warmupBlendPipelines } from './programCommon'
import type { ShaderReflection } from '../GfxDevice'
import type { GfxFill } from '../Gfx2D'
import earcut from 'earcut'
import coloredTriWgsl from '../shaders/coloredTri.wgsl?raw'
import coloredTriVertSrc from '../shaders/coloredTri.gen.vert.glsl?raw'
import coloredTriFragSrc from '../shaders/coloredTri.gen.frag.glsl?raw'
import coloredTriReflect from '../shaders/coloredTri.reflect.json'
import coloredTriRetainedWgsl from '../shaders/coloredTriRetained.wgsl?raw'
import coloredTriRetainedVertSrc from '../shaders/coloredTriRetained.gen.vert.glsl?raw'
import coloredTriRetainedFragSrc from '../shaders/coloredTriRetained.gen.frag.glsl?raw'
import coloredTriRetainedReflect from '../shaders/coloredTriRetained.reflect.json'

/**
 * `DrawParams` block size (std140): four vec4-sized members (debugColor,
 * paint, misc, flags) = 64 B. Not "just enough" (48 would be, for this
 * feature): `UboRing` rounds a slice up to `minUniformBufferOffsetAlignment`
 * (commonly 256) anyway, so the extra 16 B costs nothing in slices and leaves
 * room for the next per-run field.
 */
const DRAWPARAMS_BYTES = 64
/** `ModelColor` block size (std140): mat3 (3×vec4) + vec4 = 64 B. */
const MODELCOLOR_BYTES = 64
/** Texture unit for the shared gradient ramp atlas, in this program's group 1. */
const RAMP_ATLAS_BINDING = 3

export class ColoredTriProgram implements GpuProgram {
  readonly kind = 'coloredTri' as const

  #shader!: ShaderModule
  #stream!: RingStream
  #pipelines: Map<string, Pipeline> = new Map()
  #streamLayout!: VertexBufferLayout[]
  /** Group 1: per-run DrawParams UBO (dynamic) + the clip-mask sampler. */
  #materialLayout!: BindGroupLayout
  #drawParamsRing!: UboRing
  /**
   * Bind groups keyed by (clip texture → ramp atlas texture). Nested because
   * both vary independently: the clip is a placeholder until `setClipMask`,
   * the atlas is a placeholder until the first gradient, and each flips to
   * its real texture on its own schedule.
   */
  #clipBindGroups = new WeakMap<Texture, WeakMap<Texture, BindGroup>>()
  readonly #drawParamsStaging = new Float32Array(DRAWPARAMS_BYTES / 4)
  /**
   * `flags` (the last 4 words of `DrawParams`) is a `vec4<u32>`, so writing it
   * through the float view would stage a denormal where a flag belongs. Same
   * `ArrayBuffer`, reinterpreted, exactly like `RingStream`'s dual views.
   */
  readonly #drawParamsStagingU32 = new Uint32Array(
    this.#drawParamsStaging.buffer,
  )

  // Retained-geometry path: a second pipeline that GPU-transforms pre-uploaded
  // static geometry via a per-draw ModelColor block.
  #retainedShader!: ShaderModule
  #retainedPipelines: Map<string, Pipeline> = new Map()
  #retainedLayout!: VertexBufferLayout[]
  #retainedBindGroupLayout!: BindGroupLayout
  #retainedBindGroup!: BindGroup
  #modelColorRing!: UboRing
  readonly #modelColorStaging = new Float32Array(MODELCOLOR_BYTES / 4)
  #device!: GfxDevice
  #retainedHandles = new Set<GeometryHandle>()

  get stream(): RingStream {
    return this.#stream
  }

  init(device: GfxDevice, _ctx: GpuBatchContext): void {
    this.#device = device
    this.#shader = device.createShaderModule({
      glsl: { vertex: coloredTriVertSrc, fragment: coloredTriFragSrc },
      wgsl: {
        code: coloredTriWgsl,
        vertexEntry: 'vs_main',
        fragmentEntry: 'fs_main',
      },
      reflection: coloredTriReflect as ShaderReflection,
      label: 'coloredTri',
    })
    this.#stream = new RingStream(
      device,
      COLORED_TRI_BUFFER_BYTES,
      COLORED_TRI_STRIDE,
      'coloredTri',
    )
    this.#streamLayout = [
      {
        arrayStride: COLORED_TRI_STRIDE,
        stepMode: 'vertex',
        attributes: [
          { location: LOC_COLORED_POS, format: 'float32x2', offset: 0 },
          { location: LOC_COLORED_COLOR, format: 'unorm8x4', offset: 8 },
          { location: LOC_COLORED_UV, format: 'float32x2', offset: 12 },
        ],
      },
    ]
    this.#materialLayout = device.createBindGroupLayout([
      {
        binding: DRAWPARAMS_UBO_BINDING,
        type: 'uniform-buffer',
        dynamicOffset: true,
      },
      { binding: 1, type: 'texture-2d' },
      { binding: RAMP_ATLAS_BINDING, type: 'texture-2d' },
    ])
    this.#drawParamsRing = new UboRing(
      device,
      DRAWPARAMS_BYTES,
      2048,
      'drawParams',
    )
    this.#clipBindGroups = new WeakMap()

    // Retained-geometry pipeline: local-space `a_pos` + per-draw ModelColor.
    this.#retainedShader = device.createShaderModule({
      glsl: {
        vertex: coloredTriRetainedVertSrc,
        fragment: coloredTriRetainedFragSrc,
      },
      wgsl: {
        code: coloredTriRetainedWgsl,
        vertexEntry: 'vs_main',
        fragmentEntry: 'fs_main',
      },
      reflection: coloredTriRetainedReflect as ShaderReflection,
      label: 'coloredTriRetained',
    })
    this.#retainedLayout = [
      {
        arrayStride: 8,
        stepMode: 'vertex',
        attributes: [
          { location: LOC_COLORED_POS, format: 'float32x2', offset: 0 },
        ],
      },
    ]
    this.#retainedBindGroupLayout = device.createBindGroupLayout([
      {
        binding: MODELCOLOR_UBO_BINDING,
        type: 'uniform-buffer',
        dynamicOffset: true,
      },
    ])
    this.#modelColorRing = new UboRing(
      device,
      MODELCOLOR_BYTES,
      2048,
      'modelColor',
    )
    this.#retainedBindGroup = device.createBindGroup(
      this.#retainedBindGroupLayout,
      [
        {
          binding: MODELCOLOR_UBO_BINDING,
          resource: {
            uniformBuffer: this.#modelColorRing.buffer,
            size: MODELCOLOR_BYTES,
          },
        },
      ],
    )

    // A rebuild (context restore) re-runs init with fresh GL objects, so the
    // old per-handle descriptors are dead. Drop them and re-upload on next draw.
    for (const geo of this.#retainedHandles) geo.gpu = undefined
    this.#retainedHandles.clear()
  }

  async warmup(device: GfxDevice, ctx: GpuBatchContext): Promise<void> {
    this.#pipelines = await warmupBlendPipelines(device, ctx, {
      shader: this.#shader,
      vertexLayout: this.#streamLayout,
      bindGroupLayouts: [ctx.frameBindGroupLayout, this.#materialLayout],
    })
    this.#retainedPipelines = await warmupBlendPipelines(device, ctx, {
      shader: this.#retainedShader,
      vertexLayout: this.#retainedLayout,
      bindGroupLayouts: [
        ctx.frameBindGroupLayout,
        this.#retainedBindGroupLayout,
      ],
    })
  }

  resetFrame(): void {
    this.#drawParamsRing.reset()
    this.#modelColorRing.reset()
  }

  /**
   * Ensure `geo` is GPU-resident: upload its local-space vertices + indices to
   * static buffers once and build the VAO. Returns the descriptor (cached on
   * the handle). `geo.vertices` is already `[x0,y0,...]` tightly packed, so it
   * maps straight onto the position attribute.
   */
  #ensureGeometry(geo: GeometryHandle): GpuGeometry {
    if (geo.gpu) return geo.gpu
    const device = this.#device
    const vbo = device.createVertexBuffer(geo.vertices.byteLength)
    device.updateBufferSubData(vbo, 0, geo.vertices)
    const ibo = device.createIndexBuffer(geo.indices.byteLength)
    device.updateIndexBufferSubData(ibo, 0, geo.indices)
    const gpu: GpuGeometry = { vbo, ibo, indexCount: geo.indices.length }
    geo.gpu = gpu
    this.#retainedHandles.add(geo)
    return gpu
  }

  /**
   * Begin (or continue) the `coloredTri` batch for the current clip mask and
   * `paint`. `paint` defaults to `null` (a solid fill): passing it explicitly
   * even when `null` is what makes a solid fill right after a gradient fill
   * break the batch rather than merge into the gradient's run and draw with
   * its `DrawParams` slice.
   */
  begin(ctx: GpuBatchContext, paint: ResolvedGradientPaint | null = null): void {
    ctx.beginBatch('coloredTri', {
      clipMask: ctx.stateStack.getClipMask(),
      paint,
    })
  }

  /**
   * Resolve `fill` against the already-read current transform `t` (the same
   * one the caller uses to place its vertices). A solid color becomes a
   * packed vertex color with no per-run paint. A gradient becomes a per-run
   * {@link ResolvedGradientPaint} (the per-vertex color is then unused, so
   * `packedColor` is 0) plus the ramp row it needs, pinned until this frame's
   * draws replay. Returns `null` only when the ramp atlas is exhausted and no
   * 2D context is available to paint a recycled row (headless), in which case
   * the caller should skip the draw rather than fill with garbage.
   */
  #resolvePaintForDraw(
    ctx: GpuBatchContext,
    fill: GfxFill,
    t: TransformOut,
  ): { packedColor: number; paint: ResolvedGradientPaint | null } | null {
    const resolved = resolvePaint(fill, ctx.stateStack.getAlpha())
    if (resolved.kind === 'solid') {
      return { packedColor: resolved.packedColor, paint: null }
    }
    const g = resolved.paint
    const rampRow = ctx.textureManager.ensureStopsRow(g.stops, () =>
      ctx.forceMidFrameSubmit(),
    )
    if (rampRow < 0) return null
    const dx0 = t.a * g.x0 + t.c * g.y0 + t.e
    const dy0 = t.b * g.x0 + t.d * g.y0 + t.f
    const dx1 = t.a * g.x1 + t.c * g.y1 + t.e
    const dy1 = t.b * g.x1 + t.d * g.y1 + t.f
    const axis = gradientAxis(dx0, dy0, dx1, dy1)
    return {
      packedColor: 0,
      paint: {
        scaleDirX: axis.scaleDirX,
        scaleDirY: axis.scaleDirY,
        startOffset: axis.startOffset,
        rampRow,
        opacity: ctx.stateStack.getAlpha(),
      },
    }
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
    fill: GfxFill,
  ): void {
    ctx.txStack.read(ctx.txOut)
    const t = ctx.txOut
    const resolved = this.#resolvePaintForDraw(ctx, fill, t)
    if (!resolved) return
    const packedColor = resolved.packedColor
    this.begin(ctx, resolved.paint)
    const slot = ctx.curSlot
    // 6 verts × 5 words each.
    const wordsNeeded = 6 * COLORED_TRI_WORDS
    const off = ctx.reserveVerts(this.#stream, wordsNeeded, 6)
    if (off < 0) return
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
    // the coloredTri shader `v_uv` is only sampled when `u_clipEnabled == 1`.
    // When no clip is active, uv=(0,0) placeholders are ignored.
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
    fill: GfxFill,
  ): void {
    if (count < 3) return
    ctx.txStack.read(ctx.txOut)
    const t = ctx.txOut
    const resolved = this.#resolvePaintForDraw(ctx, fill, t)
    if (!resolved) return
    const packedColor = resolved.packedColor
    this.begin(ctx, resolved.paint)
    const slot = ctx.curSlot
    const vertCount = (count - 2) * 3
    const wordsNeeded = vertCount * COLORED_TRI_WORDS
    const off = ctx.reserveVerts(this.#stream, wordsNeeded, vertCount)
    if (off < 0) return
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
    fill: GfxFill,
  ): void {
    ctx.txStack.read(ctx.txOut)
    const t = ctx.txOut
    const resolved = this.#resolvePaintForDraw(ctx, fill, t)
    if (!resolved) return
    const packedColor = resolved.packedColor
    this.begin(ctx, resolved.paint)
    const slot = ctx.curSlot
    const triCount = geo.indices.length / 3
    const vertCount = geo.indices.length
    const wordsNeeded = vertCount * COLORED_TRI_WORDS
    const off = ctx.reserveVerts(this.#stream, wordsNeeded, vertCount)
    if (off < 0) return
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
   * A tessellated stroke outline (`strokeOutline`'s cached result): per-vertex
   * local position plus coverage (1 at the core edge, 0 at the fringe), fed
   * through the same streamed path as `fillTessellation`. Never retained
   * (see the engine guide's note on why): the tessellation is cached per
   * path, but the per-vertex CPU transform repeats every frame.
   *
   * A gradient paint's per-vertex color carries only `alpha * coverage` in
   * its alpha channel (rgb unused, the fragment samples the ramp instead),
   * so the fringe still antialiases under a gradient the same way it does
   * under a flat color.
   */
  fillOutlineTessellation(
    ctx: GpuBatchContext,
    outline: { positions: readonly number[]; coverage: readonly number[]; indices: readonly number[] },
    fill: GfxFill,
  ): void {
    ctx.txStack.read(ctx.txOut)
    const t = ctx.txOut
    const resolved = this.#resolvePaintForDraw(ctx, fill, t)
    if (!resolved) return
    const stateAlpha = ctx.stateStack.getAlpha()
    const isGradient = resolved.paint !== null
    // Parsed once, repacked per vertex with coverage folded into alpha
    // (mirrors `fillPolyLinearGradient`'s per-vertex `packAt`).
    const solid = isGradient ? null : parseColor(fill as string)
    this.begin(ctx, resolved.paint)
    const slot = ctx.curSlot
    const vertCount = outline.indices.length
    const wordsNeeded = vertCount * COLORED_TRI_WORDS
    const off = ctx.reserveVerts(this.#stream, wordsNeeded, vertCount)
    if (off < 0) return
    const mask = ctx.curClipMask
    const mrx = mask ? mask.worldRect.x : 0
    const mry = mask ? mask.worldRect.y : 0
    const invMW = mask ? 1 / mask.worldRect.width : 0
    const invMH = mask ? 1 / mask.worldRect.height : 0
    const f = this.#stream.floatView
    const u = this.#stream.uintView
    const pos = outline.positions
    const cov = outline.coverage
    const idx = outline.indices
    let cursor = off
    for (let i = 0; i < idx.length; i++) {
      const vi = idx[i]
      const lx = pos[vi * 2]
      const ly = pos[vi * 2 + 1]
      const c = cov[vi]
      const packedColor = isGradient
        ? (Math.max(0, Math.min(255, Math.round(stateAlpha * c * 255))) << 24) >>> 0
        : packRgba(solid as RGBA, stateAlpha * c)
      const dx = t.a * lx + t.c * ly + t.e
      const dy = t.b * lx + t.d * ly + t.f
      const mu = mask ? (lx - mrx) * invMW : 0
      const mv = mask ? (ly - mry) * invMH : 0
      writeColoredVert(f, u, cursor, dx, dy, packedColor, mu, mv)
      cursor += COLORED_TRI_WORDS
    }
    this.#stream.commit(slot, wordsNeeded, vertCount)
  }

  /**
   * Retained `fillPath2D`: upload `geo` once, then record a draw that
   * GPU-transforms it by the current transform (`u_model`), so no per-vertex
   * CPU work happens. The caller (`GpuGfx.fillPath2D`) gates this on no active
   * bitmap clip mask and normal debug mode, since the retained shader carries
   * neither the mask's sampler nor the debug recolor, so those cases stay on
   * the streamed path. The analytic clip does compose here. The draw binds the
   * same group-0 clip slice the streamed path does, and the retained shader
   * applies it.
   */
  fillTessellationRetained(
    ctx: GpuBatchContext,
    geo: GeometryHandle,
    color: string,
  ): void {
    const gpu = this.#ensureGeometry(geo)
    if (gpu.indexCount === 0) return
    ctx.txStack.read(ctx.txOut)
    const t = ctx.txOut
    // 2D affine → column-major mat3 for `u_model`. Fresh array per draw: the
    // command list holds it by reference until replay.
    const model = new Float32Array([t.a, t.b, 0, t.c, t.d, 0, t.e, t.f, 1])
    const c = parseColor(color)
    const a01 = ctx.stateStack.getAlpha() * c.a
    // Premultiplied 0..1, matching the source-over blend the fills expect.
    ctx.recordRetained(gpu, model, [c.r * a01, c.g * a01, c.b * a01, a01])
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
    const off = ctx.reserveVerts(this.#stream, wordsNeeded, vertCount)
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

  drawRun(ctx: GpuBatchContext, run: DrawRun): void {
    // Retained geometry: GPU-transform a pre-uploaded static buffer with a
    // per-draw model matrix + flat color. Recorded into the same command list,
    // so painter order with streamed runs holds.
    if (run.geometry) {
      this.#drawRetained(ctx, run)
      return
    }
    const firstVert = run.startWord / COLORED_TRI_WORDS
    const vertCount = (run.endWord - run.startWord) / COLORED_TRI_WORDS
    if (vertCount === 0) return

    // Resolve the clip mask + paint + debug params into the per-run
    // DrawParams slice.
    const debugModeInt =
      run.debugMode === 'overdraw' ? 1 : run.debugMode === 'batch-color' ? 2 : 0
    const maskTex = run.clipMask
      ? ctx.textureManager.ensureMaskTexture(run.clipMask)
      : null
    const clipTex = maskTex ?? ctx.placeholderTexture
    const atlasTex = ctx.textureManager.getRampAtlasTexture() ?? ctx.placeholderTexture
    const s = this.#drawParamsStaging
    const su = this.#drawParamsStagingU32
    if (debugModeInt === 2) {
      // Golden-ratio hue cycling. Index fixed at record time so the hue is
      // stable across the frame. Premultiplied (alpha baked into rgb).
      const h = ((run.debugBatchIndex * 0.61803398875) % 1) * 6
      const [r, g, b] = hsvToRgb(h, 0.75, 1)
      s[0] = r * 0.8
      s[1] = g * 0.8
      s[2] = b * 0.8
      s[3] = 0.8
    } else {
      s[0] = s[1] = s[2] = s[3] = 0
    }
    const paint = run.paint
    if (paint) {
      s[4] = paint.scaleDirX
      s[5] = paint.scaleDirY
      s[6] = paint.startOffset
      s[7] = paint.rampRow
    } else {
      s[4] = s[5] = s[6] = s[7] = 0
    }
    s[8] = 0
    s[9] = paint ? paint.opacity : 0 // misc.y: gradient alpha multiplier
    s[10] = 0
    s[11] = 0
    su[12] = maskTex ? 1 : 0 // flags.x: clipEnabled
    su[13] = debugModeInt // flags.y: debugMode
    su[14] = paint ? 1 : 0 // flags.z: paintMode (0 none, 1 gradient)
    // flags.w: dither. Never under `lighter` (the per-draw offset sums
    // instead of averaging out) and never with nothing ramping.
    su[15] = paint && run.blend !== 'lighter' && ctx.vectorQuality.dither ? 1 : 0
    const dynOffset = this.#drawParamsRing.push(ctx.device, s)
    if (dynOffset < 0) return

    // Overdraw forces additive blend so the constant red accumulates as a
    // heatmap instead of painting opaque. Otherwise it's the run's own blend.
    const blend = debugModeInt === 1 ? 'lighter' : run.blend
    const pipeline = this.#pipelines.get(blend)
    if (!pipeline) return

    ctx.device.draw({
      pipeline,
      vertexBuffers: [{ buffer: this.#stream.buffers[ctx.curSlot], offset: 0 }],
      bindGroups: [
        ctx.frameBindGroupEntry(ctx.clipOffsetForRun(run)),
        {
          group: 1,
          bindGroup: this.#clipBindGroupFor(ctx, clipTex, atlasTex),
          dynamicOffsets: [dynOffset],
        },
      ],
      vertexCount: vertCount,
      first: firstVert,
    })
    ctx.stats.drawCalls++
  }

  /** Replay one retained run: write its ModelColor slice and draw indexed. */
  #drawRetained(ctx: GpuBatchContext, run: DrawRun): void {
    const gpu = run.geometry
    const model = run.model
    const color = run.colorRgba
    if (!gpu || !model || !color) return
    // Stage the mat3 as std140 (3 vec4-aligned columns) + color vec4.
    const s = this.#modelColorStaging
    s[0] = model[0]
    s[1] = model[1]
    s[2] = model[2]
    s[4] = model[3]
    s[5] = model[4]
    s[6] = model[5]
    s[8] = model[6]
    s[9] = model[7]
    s[10] = model[8]
    s[12] = color[0]
    s[13] = color[1]
    s[14] = color[2]
    s[15] = color[3]
    const dynOffset = this.#modelColorRing.push(ctx.device, s)
    if (dynOffset < 0) return
    const pipeline = this.#retainedPipelines.get(run.blend)
    if (!pipeline) return
    ctx.device.draw({
      pipeline,
      vertexBuffers: [{ buffer: gpu.vbo, offset: 0 }],
      indexBuffer: gpu.ibo,
      bindGroups: [
        ctx.frameBindGroupEntry(ctx.clipOffsetForRun(run)),
        {
          group: 1,
          bindGroup: this.#retainedBindGroup,
          dynamicOffsets: [dynOffset],
        },
      ],
      indexCount: gpu.indexCount,
    })
    ctx.stats.drawCalls++
  }

  /**
   * The group-1 bind group for a given (clip texture, ramp atlas texture)
   * pair: the shared DrawParams ring (dynamic offset supplied per draw) plus
   * the clip and ramp samplers. Cached by texture (the placeholder for a
   * no-clip run or before the first gradient).
   */
  #clipBindGroupFor(
    ctx: GpuBatchContext,
    clipTex: Texture,
    atlasTex: Texture,
  ): BindGroup {
    let byAtlas = this.#clipBindGroups.get(clipTex)
    if (!byAtlas) {
      byAtlas = new WeakMap()
      this.#clipBindGroups.set(clipTex, byAtlas)
    }
    let bg = byAtlas.get(atlasTex)
    if (!bg) {
      bg = ctx.device.createBindGroup(this.#materialLayout, [
        {
          binding: DRAWPARAMS_UBO_BINDING,
          resource: {
            uniformBuffer: this.#drawParamsRing.buffer,
            size: DRAWPARAMS_BYTES,
          },
        },
        { binding: 1, resource: { texture: clipTex } },
        { binding: RAMP_ATLAS_BINDING, resource: { texture: atlasTex } },
      ])
      byAtlas.set(atlasTex, bg)
    }
    return bg
  }
}
