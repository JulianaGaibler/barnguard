/**
 * `GpuGfx` is the `Gfx2D` implementation that batches draws through a
 * `GfxDevice`. Records into five instanced/vertex streams (colored-tri,
 * textured-quad, stroke segments, SDF shapes, radial gradients), packs data
 * premultiplied on the CPU, and flushes only when batch state must change.
 *
 * Flush conditions: program change, texture bind change, blend mode change,
 * ring-slot buffer overflow, explicit `flush()` at a layer boundary, or
 * `endFrame`. Alpha, color, and transform changes fold into per-vertex data and
 * never flush.
 */

import type { Gfx2D, GfxBlend, GfxGradientStop, GfxStrokeStyle } from './Gfx2D'
import {
  type AttribBinding,
  type GfxBlendMode,
  type GfxDevice,
  type Program,
  type RenderTarget,
  type Texture,
  type VBuffer,
  type Vao,
} from './GfxDevice'
import { parseColor, type RGBA } from './parseColor'
import type { GeometryHandle } from './GeometryHandle'
import {
  getContourClosed,
  getPathContours,
  getPathTessellation,
  registerPathTessellation,
} from './PathTessellationRegistry'
import { TextureManager } from './TextureManager'
import { flattenQuadratic } from '../../assets/SvgPathContours'
import type { BitmapMask } from '../../assets/BitmapMask'
import earcut from 'earcut'
// GLSL sources imported as raw strings. See env.d.ts for the module type.
import coloredTriVertSrc from './webgl2/shaders/coloredTri.vert.glsl?raw'
import coloredTriFragSrc from './webgl2/shaders/coloredTri.frag.glsl?raw'
import texturedQuadVertSrc from './webgl2/shaders/texturedQuad.vert.glsl?raw'
import texturedQuadFragSrc from './webgl2/shaders/texturedQuad.frag.glsl?raw'
import strokeVertSrc from './webgl2/shaders/stroke.vert.glsl?raw'
import strokeFragSrc from './webgl2/shaders/stroke.frag.glsl?raw'
import sdfVertSrc from './webgl2/shaders/sdf.vert.glsl?raw'
import sdfFragSrc from './webgl2/shaders/sdf.frag.glsl?raw'
import gradientRadialVertSrc from './webgl2/shaders/gradientRadial.vert.glsl?raw'
import gradientRadialFragSrc from './webgl2/shaders/gradientRadial.frag.glsl?raw'

// --- constants --------------------------------------------------------------

/**
 * Colored-tri vertex layout: pos.xy (f32) + color.rgba (u8×4) + uv.xy (f32) = 5
 * words = 20 B.
 */
const COLORED_TRI_STRIDE = 20
const COLORED_TRI_WORDS = COLORED_TRI_STRIDE / 4
/**
 * Textured-quad instance layout: dst.xyzw (f32) + srcRect.xyzw (f32) +
 * tint.rgba (u8×4) = 9 words = 36 B.
 */
const TEXTURED_QUAD_INSTANCE_STRIDE = 36
/**
 * Stroke instance layout: p0.xy + p1.xy + color(u8×4) + width + dashStart +
 * dashPeriod + dashOnLen = 9 words = 36 B.
 */
const STROKE_INSTANCE_STRIDE = 36
/**
 * SDF instance layout: center.xy + (radius, strokeWidth) + colorFill(u8×4) +
 * colorStroke(u8×4) + (dashStart, dashPeriod) = 8 words = 32 B.
 */
const SDF_INSTANCE_STRIDE = 32
/**
 * Gradient-radial instance layout: center.xy + (radius, alpha) + pad(f32×2) = 6
 * words = 24 B.
 */
const GRADIENT_INSTANCE_STRIDE = 24

/**
 * Per-stream ring buffer sizes. Sized for peak scenes: the map alone produces
 * ~5k tri verts + ~6.5k stroke instances per frame, then gameplay layers
 * particles / debris / grid overlay on top.
 */
const COLORED_TRI_BUFFER_BYTES = 2 * 1024 * 1024 // 2 MB → ~104k verts
const TEXTURED_QUAD_BUFFER_BYTES = 128 * 1024 // 128 KB → ~3.6k instances
const STROKE_BUFFER_BYTES = 1 * 1024 * 1024 // 1 MB → ~29k instances
const SDF_BUFFER_BYTES = 128 * 1024 // 128 KB → ~4k instances
const GRADIENT_BUFFER_BYTES = 16 * 1024 // 16 KB  → ~682 instances

/**
 * Two buffers per stream so the GPU can read buffer N-1 while the CPU writes N.
 * VAOs are cached per (program, slot) because a VAO captures the ARRAY_BUFFER
 * bound at `vertexAttribPointer` time.
 */
const RING_SIZE = 2

/** Attribute locations. Matched to the shaders' `in` declarations. */
const LOC_COLORED_POS = 0
const LOC_COLORED_COLOR = 1
const LOC_COLORED_UV = 2
const LOC_TEXTURED_UNIT = 0
const LOC_TEXTURED_DST = 1
const LOC_TEXTURED_SRC = 2
const LOC_TEXTURED_TINT = 3
const LOC_STROKE_UNIT = 0
const LOC_STROKE_P0 = 1
const LOC_STROKE_P1 = 2
const LOC_STROKE_COLOR = 3
const LOC_STROKE_WIDTHDASH = 4
const LOC_SDF_UNIT = 0
const LOC_SDF_CENTER = 1
const LOC_SDF_RADSTROKE = 2
const LOC_SDF_COLORFILL = 3
const LOC_SDF_COLORSTROKE = 4
const LOC_SDF_DASH = 5
const LOC_GRAD_UNIT = 0
const LOC_GRAD_CENTER = 1
const LOC_GRAD_RADALPHA = 2

/** Pixel tolerance for CPU curve flattening (device px). */
const CURVE_FLATTEN_TOL_PX = 0.5
/** Max flattened points per curve segment (safety upper bound). */
const CURVE_FLATTEN_MAX_POINTS = 256

// --- transform stack --------------------------------------------------------

/**
 * A compact 6-tuple transform (a,b,c,d,e,f). Matches Canvas's `setTransform`
 * semantics: `x_screen = a*x + c*y + e`, `y_screen = b*x + d*y + f`. Stored as
 * a flat array with 6-element strides so save/restore is a pointer bump rather
 * than an allocation.
 */
class TransformStack {
  private readonly buf: Float64Array
  private top = 0 // index of top-of-stack slot

  constructor(capacity: number) {
    this.buf = new Float64Array(capacity * 6)
    // Identity at the base.
    this.buf[0] = 1
    this.buf[3] = 1
  }

  setBase(
    a: number,
    b: number,
    c: number,
    d: number,
    e: number,
    f: number,
  ): void {
    this.top = 0
    const o = 0
    this.buf[o] = a
    this.buf[o + 1] = b
    this.buf[o + 2] = c
    this.buf[o + 3] = d
    this.buf[o + 4] = e
    this.buf[o + 5] = f
  }

  push(): void {
    const from = this.top * 6
    const to = (this.top + 1) * 6
    if (to + 6 > this.buf.length) {
      console.warn(
        'GpuGfx: transform stack overflow, depth cap reached; ignoring push',
      )
      return
    }
    this.buf[to] = this.buf[from]
    this.buf[to + 1] = this.buf[from + 1]
    this.buf[to + 2] = this.buf[from + 2]
    this.buf[to + 3] = this.buf[from + 3]
    this.buf[to + 4] = this.buf[from + 4]
    this.buf[to + 5] = this.buf[from + 5]
    this.top++
  }

  pop(): void {
    if (this.top > 0) this.top--
  }

  /**
   * Post-multiply: current = current × M (where M is a
   * translation/rotate/scale).
   */
  postMultiply(
    a: number,
    b: number,
    c: number,
    d: number,
    e: number,
    f: number,
  ): void {
    const o = this.top * 6
    const ca = this.buf[o]
    const cb = this.buf[o + 1]
    const cc = this.buf[o + 2]
    const cd = this.buf[o + 3]
    const ce = this.buf[o + 4]
    const cf = this.buf[o + 5]
    this.buf[o] = ca * a + cc * b
    this.buf[o + 1] = cb * a + cd * b
    this.buf[o + 2] = ca * c + cc * d
    this.buf[o + 3] = cb * c + cd * d
    this.buf[o + 4] = ca * e + cc * f + ce
    this.buf[o + 5] = cb * e + cd * f + cf
  }

  translate(x: number, y: number): void {
    // Post-multiply by [[1,0,x],[0,1,y]]. Appends translation in the current frame.
    const o = this.top * 6
    this.buf[o + 4] += this.buf[o] * x + this.buf[o + 2] * y
    this.buf[o + 5] += this.buf[o + 1] * x + this.buf[o + 3] * y
  }

  rotate(rad: number): void {
    const cos = Math.cos(rad)
    const sin = Math.sin(rad)
    // Post-multiply by rotation.
    this.postMultiply(cos, sin, -sin, cos, 0, 0)
  }

  scale(sx: number, sy: number): void {
    // Post-multiply by scale. Scales the current basis vectors.
    const o = this.top * 6
    this.buf[o] *= sx
    this.buf[o + 1] *= sx
    this.buf[o + 2] *= sy
    this.buf[o + 3] *= sy
  }

  /** Read the 6-tuple at the current top into scratch outputs. */
  read(out: TransformOut): void {
    const o = this.top * 6
    out.a = this.buf[o]
    out.b = this.buf[o + 1]
    out.c = this.buf[o + 2]
    out.d = this.buf[o + 3]
    out.e = this.buf[o + 4]
    out.f = this.buf[o + 5]
  }
}

interface TransformOut {
  a: number
  b: number
  c: number
  d: number
  e: number
  f: number
}

// --- alpha/blend stack ------------------------------------------------------

/**
 * Alpha + blend + clip mask, snapshotted by `save`/`restore` alongside the
 * transform. Absolute (Canvas `globalAlpha` semantics).
 */
class StateStack {
  private readonly alpha: Float64Array
  private readonly blend: string[]
  private readonly clipMask: (BitmapMask | null)[]
  private top = 0

  constructor(capacity: number) {
    this.alpha = new Float64Array(capacity)
    this.blend = new Array(capacity)
    this.clipMask = new Array(capacity)
    this.alpha[0] = 1
    this.blend[0] = 'source-over'
    this.clipMask[0] = null
  }

  getAlpha(): number {
    return this.alpha[this.top]
  }
  setAlpha(a: number): void {
    this.alpha[this.top] = a
  }
  getBlend(): GfxBlend {
    return this.blend[this.top] as GfxBlend
  }
  setBlend(mode: GfxBlend): void {
    this.blend[this.top] = mode
  }
  getClipMask(): BitmapMask | null {
    return this.clipMask[this.top]
  }
  setClipMask(m: BitmapMask | null): void {
    this.clipMask[this.top] = m
  }

  push(): void {
    const nextTop = this.top + 1
    if (nextTop >= this.alpha.length) return
    this.alpha[nextTop] = this.alpha[this.top]
    this.blend[nextTop] = this.blend[this.top]
    this.clipMask[nextTop] = this.clipMask[this.top]
    this.top = nextTop
  }

  pop(): void {
    if (this.top > 0) this.top--
  }

  resetBase(): void {
    this.top = 0
    this.alpha[0] = 1
    this.blend[0] = 'source-over'
    this.clipMask[0] = null
  }
}

// --- GpuGfx -----------------------------------------------------------------

/**
 * Diagnostic render-time overlays. Toggled from the debug HUD. All non-normal
 * modes deliberately degrade the image so a developer can inspect the GPU
 * pipeline.
 *
 * **All modes affect only the `coloredTri` program.** Strokes, SDF shapes, and
 * gradient fills render normally regardless of mode. So motion-trail edges are
 * unaffected by `overdraw`, hex outlines are unaffected by `batch-color`, and
 * so on.
 *
 * - `'normal'`. Shipping look.
 * - `'polygons'`. Outline every fill's outer polygon in cyan. Verify earcut,
 *   grid, or path tessellation quality. Spot degenerate contours or missing
 *   closes. **Caveat:** emits one extra stroke per fill call, so frame time
 *   spikes noticeably on the map.
 * - `'overdraw'`. Coloredtri outputs constant dim red and the batch blend is
 *   forced to `lighter`. Hot regions accumulate red so heavy overdraw is
 *   instantly visible. Useful for catching runaway particle emitters or stacked
 *   full-frame fills. **Caveat:** the whole scene reads as additive red, so
 *   normal blending can't be judged in this mode.
 * - `'batch-color'`. Each coloredTri flush picks a distinct hue. Audit batcher
 *   grouping: a distinct node in a different colour is its own draw call
 *   (usually good). One node fragmenting into many colours means something is
 *   forcing extra flushes (usually bad). **Caveat:** the hue is per-frame. The
 *   same batch may pick a different colour on consecutive frames. Read grouping
 *   patterns, not stable colours.
 * - `'clip-mask'`. End-of-frame overlay of the registered clip mask tinted red at
 *   low alpha. Confirms the `BitmapMask` covers the region you expect (useful
 *   after asset regeneration). **Caveat:** requires
 *   `DebugController.setInspectedMask(mask)` to have been called. Session-side
 *   wiring lives in `game/session.ts`. Without registration the overlay renders
 *   nothing.
 */
export type DebugRenderMode =
  'normal' | 'polygons' | 'overdraw' | 'batch-color' | 'clip-mask'

type BatchKind =
  'none' | 'coloredTri' | 'texturedQuad' | 'stroke' | 'sdf' | 'gradientRadial'

/** Per-frame stats surfaced to the debug HUD. */
export interface GpuGfxStats {
  drawCalls: number
  programSwitches: number
  textureBinds: number
  blendSwitches: number
  overflowWarns: number
  sdfInstances: number
  strokeInstances: number
  /**
   * Effective (post-clamp) MSAA sample count on the offscreen render target.
   * `1` = off. Set once per FBO alloc, carried here for the HUD.
   */
  msaaSamples: number
}

/**
 * Counters for `Gfx2D` methods that fall through to a no-op path (e.g.
 * `strokePath2D` on a Path2D without a registered tessellation). Ticked every
 * call. Surfaced in tests and the HUD as a discovery signal for missing
 * registrations.
 */
export interface UnimplementedCounts {
  fillCircle: number
  fillConvexPoly: number
  fillPath2D: number
  fillCircleRadialGradient: number
  fillPolyLinearGradient: number
  strokeCircle: number
  strokeLine: number
  strokeQuadratic: number
  strokePolyline: number
  strokePath2D: number
  drawImageWithRotation: number
}

export class GpuGfx implements Gfx2D {
  private readonly device: GfxDevice
  private readonly canvas: HTMLCanvasElement

  // FBO target.
  private target: RenderTarget
  private targetWidth: number
  private targetHeight: number

  // Programs. Rebuilt by `initGpuResources` on context restore.
  private coloredTriProgram!: Program
  private texturedQuadProgram!: Program
  private strokeProgram!: Program
  private sdfProgram!: Program
  private gradientRadialProgram!: Program

  /** Unit-quad template shared by every instanced program. */
  private unitQuadBuffer!: VBuffer

  /**
   * Ring-buffered streams. Each slot has a GPU buffer plus a CPU staging
   * ArrayBuffer viewed through both Float32Array (positions, UVs) and
   * Uint32Array (packed unorm8×4 colors). Dual views avoid bit-twiddling a u32
   * through a f32.
   */
  private coloredTri!: RingStream
  private texturedQuad!: RingStream
  private stroke!: RingStream
  private sdf!: RingStream
  private gradientRadial!: RingStream
  /**
   * VAO per (program, slot). A WebGL VAO captures the ARRAY_BUFFER that was
   * bound at `vertexAttribPointer` time, so swapping ring slots without
   * swapping VAOs would leave draws pointed at the wrong buffer.
   */
  private coloredTriVaos: Vao[] = new Array(RING_SIZE)
  private texturedQuadVaos: Vao[] = new Array(RING_SIZE)
  private strokeVaos: Vao[] = new Array(RING_SIZE)
  private sdfVaos: Vao[] = new Array(RING_SIZE)
  private gradientRadialVaos: Vao[] = new Array(RING_SIZE)

  // Current batch. A change to any of these forces a flush.
  private curBatch: BatchKind = 'none'
  private curTexture: Texture | null = null
  private curBlend: GfxBlend = 'source-over'
  private curClipMask: BitmapMask | null = null
  private curDebugMode: DebugRenderMode = 'normal'
  /** Flush counter for `'batch-color'` hue picking. Reset each frame. */
  private debugBatchCounter = 0
  private curSlot = 0
  private inFrame = false

  /** Column-major 3×3 for `u_proj`. */
  private readonly projMat = new Float32Array(9)

  private readonly txStack = new TransformStack(32)
  private readonly stateStack = new StateStack(32)
  private readonly txOut: TransformOut = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }

  /**
   * Every texture the GPU backend uses: atlas, per-source, gradient LUTs, clip
   * masks.
   */
  private textureManager!: TextureManager

  /** Curve flattening scratch. Reused across calls since strokes don't nest. */
  private readonly flattenScratch = new Float32Array(
    CURVE_FLATTEN_MAX_POINTS * 2,
  )

  /** Warn-once state for the unsupported "rotation + drawImage" case. */
  private warnedRotatedImage = false

  readonly stats: GpuGfxStats = {
    drawCalls: 0,
    programSwitches: 0,
    textureBinds: 0,
    blendSwitches: 0,
    overflowWarns: 0,
    sdfInstances: 0,
    strokeInstances: 0,
    msaaSamples: 1,
  }
  /** Tripwire counters. Ticked when a Gfx2D call reaches a no-op path. */
  readonly unimplemented: UnimplementedCounts = {
    fillCircle: 0,
    fillConvexPoly: 0,
    fillPath2D: 0,
    fillCircleRadialGradient: 0,
    fillPolyLinearGradient: 0,
    strokeCircle: 0,
    strokeLine: 0,
    strokeQuadratic: 0,
    strokePolyline: 0,
    strokePath2D: 0,
    drawImageWithRotation: 0,
  }

  /**
   * MSAA sample count for the FBO. `1` uses a plain color texture. `>1` uses a
   * multisample renderbuffer resolved by `blitToDefault` on present. Persists
   * across resize and context restore. Live-switchable via `setSamples`.
   */
  private samples: number

  constructor(
    canvas: HTMLCanvasElement,
    device: GfxDevice,
    opts: { samples?: number } = {},
  ) {
    this.canvas = canvas
    this.device = device
    this.samples = opts.samples ?? 4
    this.targetWidth = canvas.width || 1
    this.targetHeight = canvas.height || 1
    this.target = null as unknown as RenderTarget
    this.textureManager = null as unknown as TextureManager
    this.initGpuResources()
  }

  /**
   * (Re)create every GL resource: programs, ring buffers, VAOs, FBO,
   * TextureManager. Called from the constructor and from `rebuildResources` on
   * context restore. Transform and state stacks, batching cursors, and stats
   * survive context loss (plain JS state).
   */
  private initGpuResources(): void {
    const device = this.device
    this.coloredTriProgram = device.createProgram({
      vertexSrc: coloredTriVertSrc,
      fragmentSrc: coloredTriFragSrc,
      attribs: {
        a_pos: LOC_COLORED_POS,
        a_color: LOC_COLORED_COLOR,
        a_uv: LOC_COLORED_UV,
      },
    })
    this.texturedQuadProgram = device.createProgram({
      vertexSrc: texturedQuadVertSrc,
      fragmentSrc: texturedQuadFragSrc,
      attribs: {
        a_unit: LOC_TEXTURED_UNIT,
        a_dst: LOC_TEXTURED_DST,
        a_srcRect: LOC_TEXTURED_SRC,
        a_tint: LOC_TEXTURED_TINT,
      },
    })
    this.strokeProgram = device.createProgram({
      vertexSrc: strokeVertSrc,
      fragmentSrc: strokeFragSrc,
      attribs: {
        a_unit: LOC_STROKE_UNIT,
        a_p0: LOC_STROKE_P0,
        a_p1: LOC_STROKE_P1,
        a_color: LOC_STROKE_COLOR,
        a_widthDash: LOC_STROKE_WIDTHDASH,
      },
    })
    this.sdfProgram = device.createProgram({
      vertexSrc: sdfVertSrc,
      fragmentSrc: sdfFragSrc,
      attribs: {
        a_unit: LOC_SDF_UNIT,
        a_center: LOC_SDF_CENTER,
        a_radStroke: LOC_SDF_RADSTROKE,
        a_colorFill: LOC_SDF_COLORFILL,
        a_colorStroke: LOC_SDF_COLORSTROKE,
        a_dash: LOC_SDF_DASH,
      },
    })
    this.gradientRadialProgram = device.createProgram({
      vertexSrc: gradientRadialVertSrc,
      fragmentSrc: gradientRadialFragSrc,
      attribs: {
        a_unit: LOC_GRAD_UNIT,
        a_center: LOC_GRAD_CENTER,
        a_radAlpha: LOC_GRAD_RADALPHA,
      },
    })

    this.unitQuadBuffer = device.createVertexBuffer(6 * 2 * 4)
    const unit = new Float32Array([0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1])
    device.updateBufferSubData(this.unitQuadBuffer, 0, unit)

    this.coloredTri = new RingStream(
      device,
      COLORED_TRI_BUFFER_BYTES,
      COLORED_TRI_STRIDE,
      'coloredTri',
    )
    this.texturedQuad = new RingStream(
      device,
      TEXTURED_QUAD_BUFFER_BYTES,
      TEXTURED_QUAD_INSTANCE_STRIDE,
      'texturedQuad',
    )
    this.stroke = new RingStream(
      device,
      STROKE_BUFFER_BYTES,
      STROKE_INSTANCE_STRIDE,
      'stroke',
    )
    this.sdf = new RingStream(
      device,
      SDF_BUFFER_BYTES,
      SDF_INSTANCE_STRIDE,
      'sdf',
    )
    this.gradientRadial = new RingStream(
      device,
      GRADIENT_BUFFER_BYTES,
      GRADIENT_INSTANCE_STRIDE,
      'gradientRadial',
    )

    this.coloredTriVaos = new Array(RING_SIZE)
    this.texturedQuadVaos = new Array(RING_SIZE)
    this.strokeVaos = new Array(RING_SIZE)
    this.sdfVaos = new Array(RING_SIZE)
    this.gradientRadialVaos = new Array(RING_SIZE)

    for (let slot = 0; slot < RING_SIZE; slot++) {
      const coloredAttribs: AttribBinding[] = [
        {
          buffer: this.coloredTri.buffers[slot],
          location: LOC_COLORED_POS,
          size: 2,
          type: 'float',
          normalized: false,
          offset: 0,
          stride: COLORED_TRI_STRIDE,
          divisor: 0,
        },
        {
          buffer: this.coloredTri.buffers[slot],
          location: LOC_COLORED_COLOR,
          size: 4,
          type: 'unorm8',
          normalized: true,
          offset: 8,
          stride: COLORED_TRI_STRIDE,
          divisor: 0,
        },
        {
          buffer: this.coloredTri.buffers[slot],
          location: LOC_COLORED_UV,
          size: 2,
          type: 'float',
          normalized: false,
          offset: 12,
          stride: COLORED_TRI_STRIDE,
          divisor: 0,
        },
      ]
      this.coloredTriVaos[slot] = device.createVao(
        this.coloredTriProgram,
        coloredAttribs,
      )

      const texturedAttribs: AttribBinding[] = [
        {
          buffer: this.unitQuadBuffer,
          location: LOC_TEXTURED_UNIT,
          size: 2,
          type: 'float',
          normalized: false,
          offset: 0,
          stride: 8,
          divisor: 0,
        },
        {
          buffer: this.texturedQuad.buffers[slot],
          location: LOC_TEXTURED_DST,
          size: 4,
          type: 'float',
          normalized: false,
          offset: 0,
          stride: TEXTURED_QUAD_INSTANCE_STRIDE,
          divisor: 1,
        },
        {
          buffer: this.texturedQuad.buffers[slot],
          location: LOC_TEXTURED_SRC,
          size: 4,
          type: 'float',
          normalized: false,
          offset: 16,
          stride: TEXTURED_QUAD_INSTANCE_STRIDE,
          divisor: 1,
        },
        {
          buffer: this.texturedQuad.buffers[slot],
          location: LOC_TEXTURED_TINT,
          size: 4,
          type: 'unorm8',
          normalized: true,
          offset: 32,
          stride: TEXTURED_QUAD_INSTANCE_STRIDE,
          divisor: 1,
        },
      ]
      this.texturedQuadVaos[slot] = device.createVao(
        this.texturedQuadProgram,
        texturedAttribs,
      )

      const strokeAttribs: AttribBinding[] = [
        {
          buffer: this.unitQuadBuffer,
          location: LOC_STROKE_UNIT,
          size: 2,
          type: 'float',
          normalized: false,
          offset: 0,
          stride: 8,
          divisor: 0,
        },
        {
          buffer: this.stroke.buffers[slot],
          location: LOC_STROKE_P0,
          size: 2,
          type: 'float',
          normalized: false,
          offset: 0,
          stride: STROKE_INSTANCE_STRIDE,
          divisor: 1,
        },
        {
          buffer: this.stroke.buffers[slot],
          location: LOC_STROKE_P1,
          size: 2,
          type: 'float',
          normalized: false,
          offset: 8,
          stride: STROKE_INSTANCE_STRIDE,
          divisor: 1,
        },
        {
          buffer: this.stroke.buffers[slot],
          location: LOC_STROKE_COLOR,
          size: 4,
          type: 'unorm8',
          normalized: true,
          offset: 16,
          stride: STROKE_INSTANCE_STRIDE,
          divisor: 1,
        },
        {
          buffer: this.stroke.buffers[slot],
          location: LOC_STROKE_WIDTHDASH,
          size: 4,
          type: 'float',
          normalized: false,
          offset: 20,
          stride: STROKE_INSTANCE_STRIDE,
          divisor: 1,
        },
      ]
      this.strokeVaos[slot] = device.createVao(
        this.strokeProgram,
        strokeAttribs,
      )

      const sdfAttribs: AttribBinding[] = [
        {
          buffer: this.unitQuadBuffer,
          location: LOC_SDF_UNIT,
          size: 2,
          type: 'float',
          normalized: false,
          offset: 0,
          stride: 8,
          divisor: 0,
        },
        {
          buffer: this.sdf.buffers[slot],
          location: LOC_SDF_CENTER,
          size: 2,
          type: 'float',
          normalized: false,
          offset: 0,
          stride: SDF_INSTANCE_STRIDE,
          divisor: 1,
        },
        {
          buffer: this.sdf.buffers[slot],
          location: LOC_SDF_RADSTROKE,
          size: 2,
          type: 'float',
          normalized: false,
          offset: 8,
          stride: SDF_INSTANCE_STRIDE,
          divisor: 1,
        },
        {
          buffer: this.sdf.buffers[slot],
          location: LOC_SDF_COLORFILL,
          size: 4,
          type: 'unorm8',
          normalized: true,
          offset: 16,
          stride: SDF_INSTANCE_STRIDE,
          divisor: 1,
        },
        {
          buffer: this.sdf.buffers[slot],
          location: LOC_SDF_COLORSTROKE,
          size: 4,
          type: 'unorm8',
          normalized: true,
          offset: 20,
          stride: SDF_INSTANCE_STRIDE,
          divisor: 1,
        },
        {
          buffer: this.sdf.buffers[slot],
          location: LOC_SDF_DASH,
          size: 2,
          type: 'float',
          normalized: false,
          offset: 24,
          stride: SDF_INSTANCE_STRIDE,
          divisor: 1,
        },
      ]
      this.sdfVaos[slot] = device.createVao(this.sdfProgram, sdfAttribs)

      const gradAttribs: AttribBinding[] = [
        {
          buffer: this.unitQuadBuffer,
          location: LOC_GRAD_UNIT,
          size: 2,
          type: 'float',
          normalized: false,
          offset: 0,
          stride: 8,
          divisor: 0,
        },
        {
          buffer: this.gradientRadial.buffers[slot],
          location: LOC_GRAD_CENTER,
          size: 2,
          type: 'float',
          normalized: false,
          offset: 0,
          stride: GRADIENT_INSTANCE_STRIDE,
          divisor: 1,
        },
        {
          buffer: this.gradientRadial.buffers[slot],
          location: LOC_GRAD_RADALPHA,
          size: 2,
          type: 'float',
          normalized: false,
          offset: 8,
          stride: GRADIENT_INSTANCE_STRIDE,
          divisor: 1,
        },
      ]
      this.gradientRadialVaos[slot] = device.createVao(
        this.gradientRadialProgram,
        gradAttribs,
      )
    }

    this.target = device.createRenderTarget({
      width: this.targetWidth,
      height: this.targetHeight,
      samples: this.samples,
    })
    // Reflect the effective (post-clamp) sample count in stats so the HUD
    // shows what the driver actually gave us, not what we asked for.
    this.stats.msaaSamples = this.target.samples

    // TextureManager owns every texture, atlas, per-source cache,
    // static-map, gradient LUTs. On rebuild it re-creates GL resources
    // from surviving CPU-side backing state.
    if (this.textureManager) {
      this.textureManager.rebuild(device)
    } else {
      this.textureManager = new TextureManager(device)
    }
  }

  // --- frame lifecycle ------------------------------------------------------

  /**
   * Called by Stage in place of `renderer.clear()`. Rotates the ring slot,
   * binds the FBO, and clears the frame. `pixelW`/`pixelH` are ignored here
   * (FBO clear covers the whole target); the parameters exist so Canvas2DGfx
   * and GpuGfx share the same `beginFrame` shape and Stage stays backend-
   * agnostic.
   */
  beginFrame(opts: {
    clearColor: string
    transparent: boolean
    pixelW: number
    pixelH: number
  }): void {
    void opts.pixelW
    void opts.pixelH
    this.inFrame = true
    // Rotate ring slot.
    this.curSlot = (this.curSlot + 1) % RING_SIZE
    this.coloredTri.reset(this.curSlot)
    this.texturedQuad.reset(this.curSlot)
    this.stroke.reset(this.curSlot)
    this.sdf.reset(this.curSlot)
    this.gradientRadial.reset(this.curSlot)
    this.curBatch = 'none'
    this.curTexture = null
    this.curClipMask = null
    this.debugBatchCounter = 0
    // Reset per-frame stats so the HUD reflects the frame just rendered.
    this.stats.drawCalls = 0
    this.stats.programSwitches = 0
    this.stats.textureBinds = 0
    this.stats.blendSwitches = 0
    this.stats.overflowWarns = 0
    this.stats.sdfInstances = 0
    this.stats.strokeInstances = 0
    this.updateProjection(this.targetWidth, this.targetHeight)
    this.stateStack.resetBase()
    this.txStack.setBase(1, 0, 0, 1, 0, 0)
    // Parse the CSS clear once; fully-transparent under `transparent: true`.
    const clear: readonly [number, number, number, number] = opts.transparent
      ? [0, 0, 0, 0]
      : rgbaTuple(parseColor(opts.clearColor))
    this.device.beginFrame({ target: this.target, clearColor: clear })
    this.curBlend = 'source-over'
  }

  /**
   * Explicit flush at layer boundary (Stage calls this between drawLayer
   * calls). Doesn't advance the ring slot, only commits the pending batch.
   */
  flush(): void {
    this.flushBatch()
  }

  /**
   * End of frame, flush anything pending and blit FBO to the canvas. If the
   * context was lost mid-frame, skip the flush + blit safely; `beginFrame` will
   * reset state next frame.
   */
  endFrame(): void {
    if (this.device.isContextLost()) {
      this.inFrame = false
      return
    }
    this.flushBatch()
    this.device.blitToDefault(
      this.target,
      this.canvas.width,
      this.canvas.height,
      { filter: 'linear' },
    )
    this.device.endFrame()
    this.inFrame = false
  }

  /**
   * Resize the internal render target. Kept idempotent. **Does NOT invalidate
   * the static-map bake metadata**, the reprojection matrix naturally accounts
   * for `cur.w/h` (see `computeStaticReprojection`), so a stale bake at the OLD
   * FBO size still samples correctly against the NEW FBO. Stage's own
   * `scene.invalidateStatic()` + `bakedAtCameraFrameNum = -1` in
   * `applyResize`/`setRenderScale` force a re-bake anyway on the next frame,
   * this method only handles the FBO resize itself.
   *
   * Historical note: an earlier Phase 3 draft called
   * `textureManager.invalidateStaticMapBake()` here, which made
   * DynamicResolution's mid-motion scale ticks null the bake metadata before
   * the reproject-blit could use it, the map went invisible during zoom
   * animations. Do not re-add the invalidate without matching guards in Stage's
   * motion branch.
   */
  setInternalSize(pixelW: number, pixelH: number): void {
    if (pixelW === this.targetWidth && pixelH === this.targetHeight) return
    this.targetWidth = pixelW
    this.targetHeight = pixelH
    this.device.resizeRenderTarget(this.target, pixelW, pixelH)
  }

  /**
   * No-op on GPU. WebGL2Device's `webglcontextrestored` listener drives the
   * actual re-acquisition. Stage duck-types to keep the reacquire path uniform
   * across facades.
   */
  reacquireContext(): void {
    /* intentional no-op, handled by WebGL2Device.onRestored + rebuildResources */
  }

  /**
   * Rebuild every GL resource after a `webglcontextrestored` event. Called from
   * `Stage.reacquireContext`. Recreates programs, buffers, VAOs, and the FBO;
   * tells the `TextureManager` to rebuild the atlas GL texture from its
   * surviving CPU-side backing canvas. Batch state, transform + state stacks,
   * and stats persist across the loss, only GL-owned handles die and need
   * re-creation.
   */
  rebuildResources(): void {
    if (this.device.isContextLost()) {
      console.warn(
        'GpuGfx.rebuildResources: called while context is still lost; skipping. Stage will retry on the next contextrestored event.',
      )
      return
    }
    // Clear batch state, old handles are dead.
    this.curBatch = 'none'
    this.curTexture = null
    this.curClipMask = null
    // Reset ring cursors so the first new frame starts from a clean slot.
    this.curSlot = 0
    this.initGpuResources()
  }

  // --- Gfx2D: transform ----------------------------------------------------

  setBaseTransform(
    a: number,
    b: number,
    c: number,
    d: number,
    e: number,
    f: number,
  ): void {
    this.txStack.setBase(a, b, c, d, e, f)
  }

  save(): void {
    this.txStack.push()
    this.stateStack.push()
  }

  restore(): void {
    this.txStack.pop()
    this.stateStack.pop()
  }

  translate(x: number, y: number): void {
    this.txStack.translate(x, y)
  }

  rotate(rad: number): void {
    this.txStack.rotate(rad)
  }

  scale(sx: number, sy: number): void {
    this.txStack.scale(sx, sy)
  }

  // --- Gfx2D: alpha + blend ------------------------------------------------

  setAlpha(alpha: number): void {
    // Absolute (matches Canvas globalAlpha; see Gfx2D docstring).
    this.stateStack.setAlpha(alpha)
  }

  setBlend(mode: GfxBlend): void {
    this.stateStack.setBlend(mode)
  }

  setClipMask(mask: BitmapMask | null): void {
    // Just stores on the state stack. The actual GPU state change (uniform
    // set + texture bind) happens lazily inside `startColoredTri` /
    // `flushColoredTri` when the effective mask differs from the batch's
    // baked-in mask, matches how blend + texture flips force a flush.
    this.stateStack.setClipMask(mask)
  }

  /**
   * Switch the debug render mode. Global state (not stack-scoped), the debug
   * HUD is the sole caller and it wants ALL draws affected until toggled off.
   * Flushes the current batch so old-mode pixels finish out before the new-mode
   * uniforms take effect.
   */
  setDebugRenderMode(mode: DebugRenderMode): void {
    if (this.curDebugMode === mode) return
    this.flushBatch()
    this.curDebugMode = mode
  }

  /** Current debug render mode. Read by the HUD to reflect state. */
  getDebugRenderMode(): DebugRenderMode {
    return this.curDebugMode
  }

  /**
   * Live-swap the MSAA sample count. Deletes the current offscreen render
   * target and allocates a fresh one at the requested count. Programs, VAOs,
   * ring buffers, and textures survive, only the FBO flips.
   *
   * The requested value is clamped to `[1, MAX_SAMPLES]` inside
   * `WebGL2Device.createRenderTarget`; the effective post-clamp count is
   * mirrored into `stats.msaaSamples` so the HUD shows what the driver actually
   * gave us.
   *
   * Flushes the current batch before the swap so pending draws don't get blit'd
   * onto a mid-swap target.
   */
  setSamples(samples: number): void {
    const requested = Math.max(0, Math.floor(samples))
    // Store the request so a subsequent context-loss rebuild picks it up.
    // Actual clamp/effective count read from `this.target.samples`.
    if (this.samples === requested) return
    this.flushBatch()
    this.samples = requested
    this.device.deleteRenderTarget(this.target)
    this.target = this.device.createRenderTarget({
      width: this.targetWidth,
      height: this.targetHeight,
      samples: this.samples,
    })
    this.stats.msaaSamples = this.target.samples
  }

  /** Current effective MSAA sample count (post-clamp). */
  getSamples(): number {
    return this.target.samples
  }

  /**
   * Emit a thin wireframe outline around a local-space polygon. * `'polygons'`
   * debug mode helper. `pts` is `[x0,y0,x1,y1,…]` in the caller's local
   * coordinate space; `count` is the number of POINTS. `closed=true` connects
   * the last point back to the first.
   *
   * Width is normalised to ~1 device pixel by inverting the current transform's
   * uniform scale, otherwise a highly-zoomed scene would paint dm-thick "wire"
   * that obscures the fill. Uses the same stroke pipeline as normal draws, so
   * shader-AA smooths it.
   */
  private emitDebugPolygonOutline(
    pts: ArrayLike<number>,
    count: number,
    closed: boolean,
  ): void {
    if (count < 2) return
    this.txStack.read(this.txOut)
    const t = this.txOut
    const det = Math.abs(t.a * t.d - t.b * t.c)
    const scale = det > 1e-9 ? Math.sqrt(det) : 1
    const style: GfxStrokeStyle = {
      color: 'rgba(96, 165, 250, 0.75)',
      width: 1 / scale,
    }
    for (let i = 0; i < count - 1; i++) {
      this.strokeLine(
        pts[i * 2],
        pts[i * 2 + 1],
        pts[(i + 1) * 2],
        pts[(i + 1) * 2 + 1],
        style,
      )
    }
    if (closed && count >= 3) {
      const last = count - 1
      this.strokeLine(pts[last * 2], pts[last * 2 + 1], pts[0], pts[1], style)
    }
  }

  // --- Gfx2D: fills --------------------------------------------------------

  fillRect(x: number, y: number, w: number, h: number, color: string): void {
    const packedColor = this.packColor(color)
    this.startColoredTri()
    const slot = this.curSlot
    // 6 verts × 5 words each.
    const wordsNeeded = 6 * COLORED_TRI_WORDS
    const off = this.coloredTri.reserve(slot, wordsNeeded, 6)
    if (off < 0) return
    this.txStack.read(this.txOut)
    const t = this.txOut
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
    const mask = this.curClipMask
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
    const f = this.coloredTri.floatView
    const u = this.coloredTri.uintView
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
    this.coloredTri.commit(slot, wordsNeeded, 6)
    if (this.curDebugMode === 'polygons') {
      // Rect corners CCW starting from A. `emitDebugPolygonOutline`
      // handles the closing edge.
      const rectPts = [x0, y0, x1, y0, x1, y1, x0, y1]
      this.emitDebugPolygonOutline(rectPts, 4, true)
    }
  }

  fillCircle(cx: number, cy: number, r: number, color: string): void {
    if (r <= 0) return
    // SDF instance with strokeWidth=0. CPU transform (b/c may be non-zero
    // under game-over EyeNode's scale, but SDF renders in device px so we
    // transform the center + scale the radius by the base scale.
    this.txStack.read(this.txOut)
    const t = this.txOut
    const dcx = t.a * cx + t.c * cy + t.e
    const dcy = t.b * cx + t.d * cy + t.f
    // Scale radius by the current transform's ~uniform scale factor. Use the
    // determinant's sqrt as a mean scale (correct for uniform scale; a
    // reasonable approximation for non-uniform).
    const det = Math.abs(t.a * t.d - t.b * t.c)
    const dr = r * Math.sqrt(det)
    this.emitSdfInstance(dcx, dcy, dr, 0, this.packColor(color), 0, 0, 0)
  }

  fillConvexPoly(pts: ArrayLike<number>, count: number, color: string): void {
    if (count < 3) return
    const packedColor = this.packColor(color)
    this.startColoredTri()
    const slot = this.curSlot
    const vertCount = (count - 2) * 3
    const wordsNeeded = vertCount * COLORED_TRI_WORDS
    const off = this.coloredTri.reserve(slot, wordsNeeded, vertCount)
    if (off < 0) return
    this.txStack.read(this.txOut)
    const t = this.txOut
    const mask = this.curClipMask
    const mrx = mask ? mask.worldRect.x : 0
    const mry = mask ? mask.worldRect.y : 0
    const invMW = mask ? 1 / mask.worldRect.width : 0
    const invMH = mask ? 1 / mask.worldRect.height : 0
    const f = this.coloredTri.floatView
    const u = this.coloredTri.uintView
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
    this.coloredTri.commit(slot, wordsNeeded, vertCount)
    if (this.curDebugMode === 'polygons') {
      this.emitDebugPolygonOutline(pts, count, true)
    }
  }

  fillPath2D(path: Path2D, color: string): void {
    const geo = getPathTessellation(path)
    if (!geo) {
      // No registered / cached tessellation. This is the fallback for
      // Path2Ds constructed directly (e.g. TutorialHintNode's arch). The
      // triangulator needs the `d` string, which we don't have from a
      // Path2D at runtime, so nodes that construct Path2Ds without going
      // through SvgPathMap must call `registerTessellation` explicitly.
      // Silent counter tick (as under Phase 1) so the missing registration
      // is discoverable via the HUD.
      this.unimplemented.fillPath2D++
      return
    }
    const packedColor = this.packColor(color)
    this.startColoredTri()
    const slot = this.curSlot
    const triCount = geo.indices.length / 3
    const vertCount = geo.indices.length
    const wordsNeeded = vertCount * COLORED_TRI_WORDS
    const off = this.coloredTri.reserve(slot, wordsNeeded, vertCount)
    if (off < 0) return
    this.txStack.read(this.txOut)
    const t = this.txOut
    const mask = this.curClipMask
    const mrx = mask ? mask.worldRect.x : 0
    const mry = mask ? mask.worldRect.y : 0
    const invMW = mask ? 1 / mask.worldRect.width : 0
    const invMH = mask ? 1 / mask.worldRect.height : 0
    const f = this.coloredTri.floatView
    const u = this.coloredTri.uintView
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
    this.coloredTri.commit(slot, wordsNeeded, vertCount)
    if (this.curDebugMode === 'polygons') {
      // fillPath2D can render multiple sub-paths, walk the contour list
      // registered with the tessellation so the outline matches the fill.
      const contours = getPathContours(path)
      if (contours) {
        for (let i = 0; i < contours.length; i++) {
          const c = contours[i]
          this.emitDebugPolygonOutline(
            c,
            c.length / 2,
            getContourClosed(path, i),
          )
        }
      }
    }
  }

  fillCircleRadialGradient(
    cx: number,
    cy: number,
    r: number,
    stops: readonly GfxGradientStop[],
  ): void {
    if (r <= 0 || stops.length === 0) return
    const lut = this.textureManager.ensureStopsLut(stops)
    if (!lut) return
    this.startGradientRadial(lut)
    const slot = this.curSlot
    const wordsNeeded = GRADIENT_INSTANCE_STRIDE / 4
    const off = this.gradientRadial.reserveInstance(slot)
    if (off < 0) return
    this.txStack.read(this.txOut)
    const t = this.txOut
    const dcx = t.a * cx + t.c * cy + t.e
    const dcy = t.b * cx + t.d * cy + t.f
    const det = Math.abs(t.a * t.d - t.b * t.c)
    const dr = r * Math.sqrt(det)
    const alpha = this.stateStack.getAlpha()
    const f = this.gradientRadial.floatView
    f[off + 0] = dcx
    f[off + 1] = dcy
    f[off + 2] = dr
    f[off + 3] = alpha
    f[off + 4] = 0
    f[off + 5] = 0
    void wordsNeeded
    this.gradientRadial.commitInstance(slot)
  }

  fillPolyLinearGradient(
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
    // Non-convex polygons (e.g. the motion-trail teardrop whose axis is
    // curved) must be ear-clipped, not fan-triangulated, a fan across a
    // concave outline emits inverted / overlapping triangles that read as
    // a "straight line where it shouldn't be" artefact on screen. This
    // path mirrors what Canvas2D's `ctx.fill(NON_ZERO)` handles natively.
    // Cost: earcut on ~80 points (worst-case trail) is sub-100 µs, once
    // per frame per trail, comfortably inside frame budget.
    const flat: number[] = new Array(count * 2)
    for (let i = 0; i < count * 2; i++) flat[i] = pts[i]
    const indices = earcut(flat)
    const triCount = (indices.length / 3) | 0
    if (triCount === 0) return
    this.startColoredTri()
    const slot = this.curSlot
    const vertCount = triCount * 3
    const wordsNeeded = vertCount * COLORED_TRI_WORDS
    const off = this.coloredTri.reserve(slot, wordsNeeded, vertCount)
    if (off < 0) return
    const cStart = parseColor(colorStart)
    const cEnd = parseColor(colorEnd)
    const stateAlpha = this.stateStack.getAlpha()
    this.txStack.read(this.txOut)
    const t = this.txOut
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
    const mask = this.curClipMask
    const mrx = mask ? mask.worldRect.x : 0
    const mry = mask ? mask.worldRect.y : 0
    const invMW = mask ? 1 / mask.worldRect.width : 0
    const invMH = mask ? 1 / mask.worldRect.height : 0
    const f = this.coloredTri.floatView
    const u = this.coloredTri.uintView
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
    this.coloredTri.commit(slot, wordsNeeded, vertCount)
    if (this.curDebugMode === 'polygons') {
      this.emitDebugPolygonOutline(pts, count, true)
    }
  }

  // --- Gfx2D: strokes ------------------------------------------------------

  strokeCircle(cx: number, cy: number, r: number, style: GfxStrokeStyle): void {
    if (r <= 0 || style.width <= 0) return
    this.txStack.read(this.txOut)
    const t = this.txOut
    const dcx = t.a * cx + t.c * cy + t.e
    const dcy = t.b * cx + t.d * cy + t.f
    const det = Math.abs(t.a * t.d - t.b * t.c)
    const scale = Math.sqrt(det)
    const dr = r * scale
    const dw = style.width * scale
    const dashInfo = resolveDash(style.dash)
    this.emitSdfInstance(
      dcx,
      dcy,
      dr,
      dw,
      0,
      this.packColor(style.color),
      dashInfo.dashStart,
      dashInfo.dashPeriod,
    )
  }

  strokeLine(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    style: GfxStrokeStyle,
  ): void {
    if (style.width <= 0) return
    this.txStack.read(this.txOut)
    const t = this.txOut
    const dp0x = t.a * x0 + t.c * y0 + t.e
    const dp0y = t.b * x0 + t.d * y0 + t.f
    const dp1x = t.a * x1 + t.c * y1 + t.e
    const dp1y = t.b * x1 + t.d * y1 + t.f
    const det = Math.abs(t.a * t.d - t.b * t.c)
    const scale = Math.sqrt(det)
    const dw = style.width * scale
    const dashInfo = resolveDash(style.dash, scale)
    const packedColor = this.packColor(style.color)
    this.emitStrokeInstance(
      dp0x,
      dp0y,
      dp1x,
      dp1y,
      packedColor,
      dw,
      dashInfo.dashStart,
      dashInfo.dashPeriod,
      dashInfo.dashOnLen,
    )
  }

  strokeQuadratic(
    x0: number,
    y0: number,
    cx: number,
    cy: number,
    x1: number,
    y1: number,
    style: GfxStrokeStyle,
  ): void {
    if (style.width <= 0) return
    // Flatten in local space; run through strokePolyline for join+dash handling.
    // Local tolerance: pixel tolerance divided by current transform scale.
    this.txStack.read(this.txOut)
    const t = this.txOut
    const det = Math.abs(t.a * t.d - t.b * t.c)
    const localTol = CURVE_FLATTEN_TOL_PX / (Math.sqrt(det) || 1)
    const buf = this.flattenScratch
    // Seed with start point.
    buf[0] = x0
    buf[1] = y0
    let cursor = 2
    cursor = flattenQuadratic(x0, y0, cx, cy, x1, y1, localTol, buf, cursor)
    const count = cursor / 2
    this.strokePolyline(buf, count, style)
  }

  strokePolyline(
    pts: ArrayLike<number>,
    count: number,
    style: GfxStrokeStyle,
  ): void {
    if (count < 2 || style.width <= 0) return
    // Optional midpoint-quadratic smoothing (matches Canvas2DGfx behavior).
    if (style.smoothing === 'quadratic' && count >= 3) {
      const smoothed = this.smoothToBuffer(pts, count)
      this.emitPolylineInstances(smoothed.buf, smoothed.count, style)
      return
    }
    this.emitPolylineInstances(pts, count, style)
  }

  strokePath2D(path: Path2D, style: GfxStrokeStyle): void {
    const contours = getPathContours(path)
    if (!contours) {
      // No cached contours for this Path2D. Callers that construct
      // Path2Ds outside SvgPathMap must call `registerTessellation`
      // (which also stashes contours), the counter surfaces missing
      // registrations in the HUD.
      this.unimplemented.strokePath2D++
      return
    }
    for (let i = 0; i < contours.length; i++) {
      const c = contours[i]
      const count = c.length / 2
      if (count < 2) continue
      const closed = getContourClosed(path, i)
      const perContourStyle: GfxStrokeStyle = { ...style, closed }
      this.emitPolylineInstances(c, count, perContourStyle)
    }
  }

  // --- Gfx2D: images -------------------------------------------------------

  drawImage(
    img: CanvasImageSource,
    dx: number,
    dy: number,
    dw: number,
    dh: number,
  ): void {
    this.txStack.read(this.txOut)
    const t = this.txOut
    // Phase 1 axis-aligned assumption: no rotation in the current transform.
    // Nodes that rotate (DebrisBurst, etc.) don't call drawImage in the game.
    if (Math.abs(t.b) > 1e-9 || Math.abs(t.c) > 1e-9) {
      this.unimplemented.drawImageWithRotation++
      if (!this.warnedRotatedImage) {
        this.warnedRotatedImage = true
        console.warn(
          'GpuGfx.drawImage: current transform has rotation/skew; Phase 1 draws axis-aligned only. Node ignored.',
        )
      }
      return
    }
    const entry = this.textureManager.getOrCreateEntry(img)
    if (entry === null) return
    // Discriminate atlas entry vs standalone Texture. Atlas entries carry
    // a `srcRect` field; standalone Textures don't.
    let tex: Texture
    let u0: number, v0: number, u1: number, v1: number
    if ('srcRect' in entry) {
      tex = entry.tex
      const r = entry.srcRect
      u0 = r[0]
      v0 = r[1]
      u1 = r[2]
      v1 = r[3]
    } else {
      tex = entry
      u0 = 0
      v0 = 0
      u1 = 1
      v1 = 1
    }
    this.startInstancedTextured(tex)
    const slot = this.curSlot
    const words = this.texturedQuad.reserveInstance(slot)
    if (words < 0) return
    const alpha = this.stateStack.getAlpha()
    const tintByte = Math.max(0, Math.min(255, Math.round(alpha * 255)))
    const packedTint =
      (tintByte << 24) | (tintByte << 16) | (tintByte << 8) | tintByte
    const dstX = t.a * dx + t.e
    const dstY = t.d * dy + t.f
    const dstW = t.a * dw
    const dstH = t.d * dh
    const fv = this.texturedQuad.floatView
    const uv = this.texturedQuad.uintView
    fv[words + 0] = dstX
    fv[words + 1] = dstY
    fv[words + 2] = dstW
    fv[words + 3] = dstH
    fv[words + 4] = u0
    fv[words + 5] = v0
    fv[words + 6] = u1
    fv[words + 7] = v1
    uv[words + 8] = packedTint >>> 0
    this.texturedQuad.commitInstance(slot)
  }

  // --- registration (called by asset loaders) -------------------------------

  /**
   * Install a tessellation for a given `Path2D` so subsequent `fillPath2D(path,
   * …)` and `strokePath2D(path, …)` calls resolve against a cached
   * triangulation / contour set. Delegates to the process-wide
   * `PathTessellationRegistry`; nodes and asset loaders can also register there
   * directly.
   */
  registerTessellation(
    path: Path2D,
    geometry: GeometryHandle,
    contours?: Float32Array[],
  ): void {
    registerPathTessellation(path, geometry, contours)
  }

  // --- internals -----------------------------------------------------------

  private emitSdfInstance(
    cx: number,
    cy: number,
    radius: number,
    strokeWidth: number,
    packedFill: number,
    packedStroke: number,
    dashStart: number,
    dashPeriod: number,
  ): void {
    this.startSdf()
    const slot = this.curSlot
    const off = this.sdf.reserveInstance(slot)
    if (off < 0) return
    const f = this.sdf.floatView
    const u = this.sdf.uintView
    f[off + 0] = cx
    f[off + 1] = cy
    f[off + 2] = radius
    f[off + 3] = strokeWidth
    u[off + 4] = packedFill >>> 0
    u[off + 5] = packedStroke >>> 0
    f[off + 6] = dashStart
    f[off + 7] = dashPeriod
    this.sdf.commitInstance(slot)
    this.stats.sdfInstances++
  }

  private emitStrokeInstance(
    p0x: number,
    p0y: number,
    p1x: number,
    p1y: number,
    packedColor: number,
    width: number,
    dashStart: number,
    dashPeriod: number,
    dashOnLen: number,
  ): void {
    this.startStroke()
    const slot = this.curSlot
    const off = this.stroke.reserveInstance(slot)
    if (off < 0) return
    const f = this.stroke.floatView
    const u = this.stroke.uintView
    f[off + 0] = p0x
    f[off + 1] = p0y
    f[off + 2] = p1x
    f[off + 3] = p1y
    u[off + 4] = packedColor >>> 0
    f[off + 5] = width
    f[off + 6] = dashStart
    f[off + 7] = dashPeriod
    f[off + 8] = dashOnLen
    this.stroke.commitInstance(slot)
    this.stats.strokeInstances++
  }

  /**
   * Common polyline emitter: transforms local points to device px, emits N-1
   * stroke segments with dashStart accumulating across the polyline, plus join
   * discs at interior vertices under `source-over` (skipped under `lighter` to
   * avoid brightening).
   */
  private emitPolylineInstances(
    pts: ArrayLike<number>,
    count: number,
    style: GfxStrokeStyle,
  ): void {
    if (count < 2) return
    this.txStack.read(this.txOut)
    const t = this.txOut
    const det = Math.abs(t.a * t.d - t.b * t.c)
    const scale = Math.sqrt(det)
    const dw = style.width * scale
    const dashInfo = resolveDash(style.dash, scale)
    const packedColor = this.packColor(style.color)
    const closed = style.closed === true
    const emitJoins = (style.join ?? 'miter') !== 'miter' || true
    // Skip join discs under lighter blend to avoid double-brightening at
    // interior vertices. The plan agent's R6 mitigation.
    const doJoins = this.stateStack.getBlend() !== 'lighter' && emitJoins

    let prevDx = t.a * pts[0] + t.c * pts[1] + t.e
    let prevDy = t.b * pts[0] + t.d * pts[1] + t.f
    let dashStart = 0
    const segTotal = closed ? count : count - 1
    for (let i = 1; i <= segTotal; i++) {
      const j = i === count ? 0 : i
      const curLx = pts[j * 2]
      const curLy = pts[j * 2 + 1]
      const curDx = t.a * curLx + t.c * curLy + t.e
      const curDy = t.b * curLx + t.d * curLy + t.f
      this.emitStrokeInstance(
        prevDx,
        prevDy,
        curDx,
        curDy,
        packedColor,
        dw,
        dashStart,
        dashInfo.dashPeriod,
        dashInfo.dashOnLen,
      )
      // Join disc at the interior vertex we just arrived at (skip on final
      // vertex of open polyline; do emit on closed's last vertex).
      const isInterior = closed || i < segTotal
      if (doJoins && isInterior) {
        this.emitStrokeInstance(
          curDx,
          curDy,
          curDx,
          curDy,
          packedColor,
          dw,
          0,
          0,
          0,
        )
      }
      // Advance dash phase along this segment length.
      const sx = curDx - prevDx
      const sy = curDy - prevDy
      dashStart += Math.sqrt(sx * sx + sy * sy)
      prevDx = curDx
      prevDy = curDy
    }
  }

  /**
   * Midpoint-Bézier smoothing (matches Canvas2DGfx `smoothing: 'quadratic'`):
   * lineTo(midpoint), then quadraticCurveTo per interior point using the
   * midpoint of successive points as the anchor. Flattens to line segments in
   * the scratch buffer + returns the point count.
   */
  private smoothToBuffer(
    pts: ArrayLike<number>,
    count: number,
  ): { buf: Float32Array; count: number } {
    this.txStack.read(this.txOut)
    const t = this.txOut
    const det = Math.abs(t.a * t.d - t.b * t.c)
    const localTol = CURVE_FLATTEN_TOL_PX / (Math.sqrt(det) || 1)
    const buf = this.flattenScratch
    let cursor = 0
    // First point.
    buf[cursor++] = pts[0]
    buf[cursor++] = pts[1]
    // Midpoint of first segment.
    const m0x = (pts[0] + pts[2]) * 0.5
    const m0y = (pts[1] + pts[3]) * 0.5
    buf[cursor++] = m0x
    buf[cursor++] = m0y
    // Interior quadratics.
    let curX = m0x
    let curY = m0y
    for (let i = 1; i < count - 1; i++) {
      const ctrlX = pts[i * 2]
      const ctrlY = pts[i * 2 + 1]
      const nextX = pts[(i + 1) * 2]
      const nextY = pts[(i + 1) * 2 + 1]
      const anchorX = (ctrlX + nextX) * 0.5
      const anchorY = (ctrlY + nextY) * 0.5
      cursor = flattenQuadratic(
        curX,
        curY,
        ctrlX,
        ctrlY,
        anchorX,
        anchorY,
        localTol,
        buf,
        cursor,
      )
      curX = anchorX
      curY = anchorY
    }
    // Terminal line to last input point.
    if (cursor + 2 <= buf.length) {
      buf[cursor++] = pts[(count - 1) * 2]
      buf[cursor++] = pts[(count - 1) * 2 + 1]
    }
    return { buf, count: cursor / 2 }
  }

  private packColor(css: string): number {
    const rgba = parseColor(css)
    const alpha = this.stateStack.getAlpha() * rgba.a
    const r = Math.max(0, Math.min(255, Math.round(rgba.r * alpha * 255)))
    const g = Math.max(0, Math.min(255, Math.round(rgba.g * alpha * 255)))
    const b = Math.max(0, Math.min(255, Math.round(rgba.b * alpha * 255)))
    const a = Math.max(0, Math.min(255, Math.round(alpha * 255)))
    // Little-endian packing: byte 0 (R) at low bits, byte 3 (A) at high bits.
    // WebGL's UNSIGNED_BYTE reader consumes them in memory order, matching.
    return (a << 24) | (b << 16) | (g << 8) | r
  }

  private startColoredTri(): void {
    const wantBlend = this.stateStack.getBlend()
    const wantMask = this.stateStack.getClipMask()
    if (
      this.curBatch === 'coloredTri' &&
      this.curBlend === wantBlend &&
      this.curClipMask === wantMask
    ) {
      return
    }
    this.flushBatch()
    this.curBatch = 'coloredTri'
    this.curBlend = wantBlend
    this.curClipMask = wantMask
  }

  private startInstancedTextured(tex: Texture): void {
    const wantBlend = this.stateStack.getBlend()
    if (
      this.curBatch === 'texturedQuad' &&
      this.curTexture === tex &&
      this.curBlend === wantBlend
    )
      return
    this.flushBatch()
    this.curBatch = 'texturedQuad'
    this.curTexture = tex
    this.curBlend = wantBlend
  }

  private startStroke(): void {
    const wantBlend = this.stateStack.getBlend()
    if (this.curBatch === 'stroke' && this.curBlend === wantBlend) return
    this.flushBatch()
    this.curBatch = 'stroke'
    this.curBlend = wantBlend
  }

  private startSdf(): void {
    const wantBlend = this.stateStack.getBlend()
    if (this.curBatch === 'sdf' && this.curBlend === wantBlend) return
    this.flushBatch()
    this.curBatch = 'sdf'
    this.curBlend = wantBlend
  }

  private startGradientRadial(lut: Texture): void {
    const wantBlend = this.stateStack.getBlend()
    if (
      this.curBatch === 'gradientRadial' &&
      this.curTexture === lut &&
      this.curBlend === wantBlend
    )
      return
    this.flushBatch()
    this.curBatch = 'gradientRadial'
    this.curTexture = lut
    this.curBlend = wantBlend
  }

  private flushBatch(): void {
    if (this.curBatch === 'none') return
    const blendMode: GfxBlendMode =
      this.curBlend === 'lighter' ? 'lighter' : 'source-over'
    this.device.setBlend(blendMode)
    this.stats.blendSwitches++
    switch (this.curBatch) {
      case 'coloredTri':
        this.flushColoredTri()
        break
      case 'texturedQuad':
        this.flushTexturedQuad()
        break
      case 'stroke':
        this.flushStroke()
        break
      case 'sdf':
        this.flushSdf()
        break
      case 'gradientRadial':
        this.flushGradientRadial()
        break
    }
    this.curBatch = 'none'
  }

  private flushColoredTri(): void {
    const slot = this.curSlot
    const words = this.coloredTri.pendingWords[slot]
    if (words === 0) return
    const vertCount = this.coloredTri.pendingVerts[slot]
    this.device.updateBufferSubData(
      this.coloredTri.buffers[slot],
      0,
      this.coloredTri.floatView,
      0,
      words * 4,
    )
    this.device.useProgram(this.coloredTriProgram)
    this.stats.programSwitches++
    this.device.setUniformMat3(this.coloredTriProgram, 'u_proj', this.projMat)
    // Clip-mask state. `u_clipEnabled = 1` triggers the fragment sampler
    // path; bind the mask to unit 1 (unit 0 stays reserved for
    // texturedQuad's atlas so a program flip doesn't clobber it).
    if (this.curClipMask) {
      const maskTex = this.textureManager.ensureMaskTexture(this.curClipMask)
      if (maskTex) {
        this.device.setUniform1i(this.coloredTriProgram, 'u_clipEnabled', 1)
        this.device.setUniformTexture(
          this.coloredTriProgram,
          'u_clipTex',
          maskTex,
          1,
        )
        this.stats.textureBinds++
      } else {
        this.device.setUniform1i(this.coloredTriProgram, 'u_clipEnabled', 0)
      }
    } else {
      this.device.setUniform1i(this.coloredTriProgram, 'u_clipEnabled', 0)
    }
    // Debug render-mode uniforms + blend override.
    // Modes 3 (clip-mask) and 'polygons' don't touch the coloredTri shader
    //, the former is an end-of-frame overlay via DebugController; the
    // latter emits extra strokes at fill sites.
    let debugModeInt = 0
    if (this.curDebugMode === 'overdraw') debugModeInt = 1
    else if (this.curDebugMode === 'batch-color') debugModeInt = 2
    this.device.setUniform1i(
      this.coloredTriProgram,
      'u_debugMode',
      debugModeInt,
    )
    if (debugModeInt === 2) {
      // Golden-ratio hue cycling, visually distinct neighbouring batches.
      const h = ((this.debugBatchCounter * 0.61803398875) % 1) * 6
      const [r, g, b] = hsvToRgb(h, 0.75, 1)
      // Premultiplied output, alpha is baked into rgb.
      this.device.setUniform4f(
        this.coloredTriProgram,
        'u_debugColor',
        r * 0.8,
        g * 0.8,
        b * 0.8,
        0.8,
      )
    } else {
      // Silent zero, the shader ignores when mode != 2, but avoid
      // leaving a stale value from a prior batch.
      this.device.setUniform4f(
        this.coloredTriProgram,
        'u_debugColor',
        0,
        0,
        0,
        0,
      )
    }
    this.debugBatchCounter++
    // Overdraw forces additive blend, otherwise `source-over` would
    // paint an opaque red instead of the intended accumulating heatmap.
    if (debugModeInt === 1) {
      this.device.setBlend('lighter')
    }
    this.device.bindVao(this.coloredTriVaos[slot])
    this.device.drawArrays(0, vertCount)
    this.stats.drawCalls++
    this.coloredTri.commitFlushed(slot)
  }

  private flushTexturedQuad(): void {
    const slot = this.curSlot
    const words = this.texturedQuad.pendingWords[slot]
    if (words === 0) return
    const instCount = this.texturedQuad.pendingInstances[slot]
    this.device.updateBufferSubData(
      this.texturedQuad.buffers[slot],
      0,
      this.texturedQuad.floatView,
      0,
      words * 4,
    )
    this.device.useProgram(this.texturedQuadProgram)
    this.stats.programSwitches++
    this.device.setUniformMat3(this.texturedQuadProgram, 'u_proj', this.projMat)
    if (this.curTexture) {
      this.device.setUniformTexture(
        this.texturedQuadProgram,
        'u_tex',
        this.curTexture,
        0,
      )
      this.stats.textureBinds++
    }
    this.device.bindVao(this.texturedQuadVaos[slot])
    this.device.drawArraysInstanced(0, 6, instCount)
    this.stats.drawCalls++
    this.texturedQuad.commitFlushed(slot)
  }

  private flushStroke(): void {
    const slot = this.curSlot
    const words = this.stroke.pendingWords[slot]
    if (words === 0) return
    const instCount = this.stroke.pendingInstances[slot]
    this.device.updateBufferSubData(
      this.stroke.buffers[slot],
      0,
      this.stroke.floatView,
      0,
      words * 4,
    )
    this.device.useProgram(this.strokeProgram)
    this.stats.programSwitches++
    this.device.setUniformMat3(this.strokeProgram, 'u_proj', this.projMat)
    this.device.bindVao(this.strokeVaos[slot])
    this.device.drawArraysInstanced(0, 6, instCount)
    this.stats.drawCalls++
    this.stroke.commitFlushed(slot)
  }

  private flushSdf(): void {
    const slot = this.curSlot
    const words = this.sdf.pendingWords[slot]
    if (words === 0) return
    const instCount = this.sdf.pendingInstances[slot]
    this.device.updateBufferSubData(
      this.sdf.buffers[slot],
      0,
      this.sdf.floatView,
      0,
      words * 4,
    )
    this.device.useProgram(this.sdfProgram)
    this.stats.programSwitches++
    this.device.setUniformMat3(this.sdfProgram, 'u_proj', this.projMat)
    this.device.bindVao(this.sdfVaos[slot])
    this.device.drawArraysInstanced(0, 6, instCount)
    this.stats.drawCalls++
    this.sdf.commitFlushed(slot)
  }

  private flushGradientRadial(): void {
    const slot = this.curSlot
    const words = this.gradientRadial.pendingWords[slot]
    if (words === 0) return
    const instCount = this.gradientRadial.pendingInstances[slot]
    this.device.updateBufferSubData(
      this.gradientRadial.buffers[slot],
      0,
      this.gradientRadial.floatView,
      0,
      words * 4,
    )
    this.device.useProgram(this.gradientRadialProgram)
    this.stats.programSwitches++
    this.device.setUniformMat3(
      this.gradientRadialProgram,
      'u_proj',
      this.projMat,
    )
    if (this.curTexture) {
      this.device.setUniformTexture(
        this.gradientRadialProgram,
        'u_stops',
        this.curTexture,
        0,
      )
      this.stats.textureBinds++
    }
    this.device.bindVao(this.gradientRadialVaos[slot])
    this.device.drawArraysInstanced(0, 6, instCount)
    this.stats.drawCalls++
    this.gradientRadial.commitFlushed(slot)
  }

  private updateProjection(w: number, h: number): void {
    // Device-px → clip with Y-flip.
    // clip.x = 2 * x / w - 1
    // clip.y = 1 - 2 * y / h
    // As a column-major mat3:
    //   col 0: [2/w, 0, 0]
    //   col 1: [0, -2/h, 0]
    //   col 2: [-1, 1, 1]
    const p = this.projMat
    p[0] = 2 / w
    p[1] = 0
    p[2] = 0
    p[3] = 0
    p[4] = -2 / h
    p[5] = 0
    p[6] = -1
    p[7] = 1
    p[8] = 1
  }
}

// --- helpers ---------------------------------------------------------------

function rgbaTuple(c: RGBA): readonly [number, number, number, number] {
  return [c.r, c.g, c.b, c.a]
}

/**
 * Turn a `[on, off, …]` Canvas-style dash pattern into `(dashStart, dashPeriod,
 * dashOnLen)` scaled to device px. Only the first `[on, off]` pair is honored,
 * the game's dash configs are all 2-element (matches
 * `Canvas2DGfx.applyStroke`'s single-pattern usage; more complex dashes would
 * need a shader upgrade). `dashPeriod === 0` disables dashing in the shader.
 */
function resolveDash(
  dash: readonly number[] | undefined,
  scale = 1,
): { dashStart: number; dashPeriod: number; dashOnLen: number } {
  if (!dash || dash.length < 2) {
    return { dashStart: 0, dashPeriod: 0, dashOnLen: 0 }
  }
  const on = dash[0] * scale
  const off = dash[1] * scale
  return { dashStart: 0, dashPeriod: on + off, dashOnLen: on }
}

/**
 * Write one colored-tri vertex at word `off` in the dual-view buffer. Pos + UV
 * go through the float view, packed color through the uint view, they share the
 * same underlying ArrayBuffer so writes are aliased correctly.
 */
function writeColoredVert(
  fv: Float32Array,
  uv: Uint32Array,
  off: number,
  x: number,
  y: number,
  packedColor: number,
  u: number,
  v: number,
): void {
  fv[off] = x
  fv[off + 1] = y
  uv[off + 2] = packedColor >>> 0
  fv[off + 3] = u
  fv[off + 4] = v
}

/**
 * HSV → RGB (all in `[0, 1]`, hue argument in the `[0, 6)` sector space). Used
 * only by the `'batch-color'` debug mode, hue picked with the golden-ratio
 * conjugate so neighbouring batches read as visually separated colours.
 */
function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const i = Math.floor(h)
  const f = h - i
  const p = v * (1 - s)
  const q = v * (1 - s * f)
  const t = v * (1 - s * (1 - f))
  switch (i % 6) {
    case 0:
      return [v, t, p]
    case 1:
      return [q, v, p]
    case 2:
      return [p, v, t]
    case 3:
      return [p, q, v]
    case 4:
      return [t, p, v]
    default:
      return [v, p, q]
  }
}

/**
 * A double-buffered CPU-staging + GPU-buffer pair. `buffers[slot]` is the
 * GPU-side VBO; `floatView`/`uintView` are dual views over ONE shared
 * ArrayBuffer that we memcpy-out per flush. Reservations advance a per-slot
 * cursor; overflow → warn + skip.
 */
class RingStream {
  readonly buffers: VBuffer[] = new Array(RING_SIZE)
  readonly cpuBuffer: ArrayBuffer
  readonly floatView: Float32Array
  readonly uintView: Uint32Array
  readonly pendingWords: Uint32Array = new Uint32Array(RING_SIZE)
  readonly pendingVerts: Uint32Array = new Uint32Array(RING_SIZE)
  readonly pendingInstances: Uint32Array = new Uint32Array(RING_SIZE)
  readonly byteSize: number
  readonly wordSize: number
  readonly recordStride: number
  readonly label: string
  private warned = false

  constructor(
    device: GfxDevice,
    byteSize: number,
    recordStride: number,
    label = 'stream',
  ) {
    this.byteSize = byteSize
    this.wordSize = byteSize / 4
    this.recordStride = recordStride
    this.label = label
    this.cpuBuffer = new ArrayBuffer(byteSize)
    this.floatView = new Float32Array(this.cpuBuffer)
    this.uintView = new Uint32Array(this.cpuBuffer)
    for (let i = 0; i < RING_SIZE; i++) {
      this.buffers[i] = device.createVertexBuffer(byteSize)
    }
  }

  reset(slot: number): void {
    this.pendingWords[slot] = 0
    this.pendingVerts[slot] = 0
    this.pendingInstances[slot] = 0
    this.warned = false
  }

  /**
   * Reserve `wordsNeeded` for a vertex batch, returns the word offset in the
   * CPU buffer or `-1` on overflow.
   */
  reserve(slot: number, wordsNeeded: number, vertCount: number): number {
    const cur = this.pendingWords[slot]
    if (cur + wordsNeeded > this.wordSize) {
      this.warnOverflow(vertCount)
      return -1
    }
    void vertCount // used only in commit()
    return cur
  }

  commit(slot: number, wordsAdded: number, vertCount: number): void {
    this.pendingWords[slot] += wordsAdded
    this.pendingVerts[slot] += vertCount
  }

  /** Reserve one instance record; return the word offset. */
  reserveInstance(slot: number): number {
    const cur = this.pendingWords[slot]
    const wordsNeeded = this.recordStride / 4
    if (cur + wordsNeeded > this.wordSize) {
      this.warnOverflow(1)
      return -1
    }
    return cur
  }

  commitInstance(slot: number): void {
    this.pendingWords[slot] += this.recordStride / 4
    this.pendingInstances[slot] += 1
  }

  /** Called after `updateBufferSubData` on flush, resets the cursor. */
  commitFlushed(slot: number): void {
    this.pendingWords[slot] = 0
    this.pendingVerts[slot] = 0
    this.pendingInstances[slot] = 0
  }

  private warnOverflow(dropped: number): void {
    if (this.warned) return
    this.warned = true
    const cap = Math.floor(this.byteSize / this.recordStride)
    console.warn(
      `GpuGfx: '${this.label}' buffer overflow, dropping ${dropped} record(s) for the remainder of this frame (capacity ${cap} × ${this.recordStride}B = ${(this.byteSize / 1024).toFixed(0)} KB)`,
    )
  }
}
