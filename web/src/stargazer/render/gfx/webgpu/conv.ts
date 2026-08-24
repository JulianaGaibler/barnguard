// Enum maps from the backend-neutral `GfxDevice` vocabulary to the WebGPU
// enums. Kept out of `WebGPUDevice` so the device body stays about resource
// lifecycle and pass recording rather than string tables.

import type {
  ColorFormat,
  ColorState,
  CompareFn,
  CullMode,
  DepthStencilFormat,
  FrontFace,
  GfxBlendMode,
  IndexType,
  PipelineDesc,
  PrimitiveTopology,
  StencilFaceState,
  StencilOp,
  VertexFormat,
} from '../GfxDevice'
import {
  hasDepthAspect,
  hasStencilAspect,
  resolveDepthStencil,
} from '../depthStencil'

/** Vertex attribute format → WebGPU vertex format. */
export function vertexFormatToGPU(f: VertexFormat): GPUVertexFormat {
  switch (f) {
    case 'float32':
      return 'float32'
    case 'float32x2':
      return 'float32x2'
    case 'float32x3':
      return 'float32x3'
    case 'float32x4':
      return 'float32x4'
    case 'unorm8x4':
      return 'unorm8x4'
    case 'uint8x4':
      return 'uint8x4'
  }
}

/**
 * Color-target format → WebGPU texture format. The swapchain uses the browser's
 * preferred canvas format instead, so present-time targets pass that through.
 */
export function colorFormatToGPU(f: ColorFormat): GPUTextureFormat {
  return f === 'srgb' ? 'rgba8unorm-srgb' : 'rgba8unorm'
}

/**
 * Blend mode → WebGPU blend state, or `undefined` for no blending. Colors are
 * premultiplied end-to-end, so `'source-over'` uses a `'one'` source factor
 * (the shader already multiplied rgb by alpha) rather than `'src-alpha'`.
 */
export function blendToGPU(mode: GfxBlendMode): GPUBlendState | undefined {
  if (mode === 'none') return undefined
  if (mode === 'lighter') {
    // Additive: src + dst for both color and alpha.
    return {
      color: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
      alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
    }
  }
  // 'source-over' premultiplied over: src + dst * (1 - srcAlpha).
  return {
    color: {
      srcFactor: 'one',
      dstFactor: 'one-minus-src-alpha',
      operation: 'add',
    },
    alpha: {
      srcFactor: 'one',
      dstFactor: 'one-minus-src-alpha',
      operation: 'add',
    },
  }
}

/**
 * `GPUColorWrite.ALL`. Spelled as its value so this module stays free of WebGPU
 * runtime globals and can be exercised outside a browser.
 */
const COLOR_WRITE_ALL = 0xf

/**
 * Color-target state → WebGPU color target. A `write` of `false` becomes a zero
 * write mask, which keeps the fragment stage and its depth/stencil side effects
 * while leaving the color attachment untouched.
 */
export function colorTargetToGPU(color: ColorState): GPUColorTargetState {
  return {
    format: colorFormatToGPU(color.format),
    blend: blendToGPU(color.blend),
    writeMask: color.write === false ? 0 : COLOR_WRITE_ALL,
  }
}

/**
 * Depth/stencil comparison → WebGPU compare function. The names line up
 * one-to-one, so this is an exhaustiveness check as much as a conversion.
 */
export function compareFnToGPU(c: CompareFn): GPUCompareFunction {
  switch (c) {
    case 'less-equal':
      return 'less-equal'
    case 'greater-equal':
      return 'greater-equal'
    case 'less':
      return 'less'
    case 'greater':
      return 'greater'
    case 'equal':
      return 'equal'
    case 'not-equal':
      return 'not-equal'
    case 'always':
      return 'always'
    case 'never':
      return 'never'
  }
}

/** Stencil op → WebGPU stencil operation. The names line up one-to-one. */
export function stencilOpToGPU(op: StencilOp): GPUStencilOperation {
  return op
}

/** One facing's stencil state → WebGPU, filling in the pass-through defaults. */
export function stencilFaceToGPU(f: StencilFaceState): GPUStencilFaceState {
  return {
    compare: compareFnToGPU(f.compare ?? 'always'),
    failOp: stencilOpToGPU(f.failOp ?? 'keep'),
    depthFailOp: stencilOpToGPU(f.depthFailOp ?? 'keep'),
    passOp: stencilOpToGPU(f.passOp ?? 'keep'),
  }
}

/** Depth-stencil aspects → the WebGPU texture format carrying them. */
export function depthStencilFormatToGPU(
  f: DepthStencilFormat,
): GPUTextureFormat | null {
  switch (f) {
    case 'none':
      return null
    case 'depth':
      return 'depth24plus'
    case 'stencil':
      return 'stencil8'
    case 'depth-stencil':
      return 'depth24plus-stencil8'
  }
}

/**
 * A pipeline's depth-stencil state, or `undefined` for a pipeline that draws
 * into no depth-stencil attachment.
 *
 * WebGPU requires state for every aspect the attachment format carries and
 * rejects state for an aspect it does not, so the format drives this rather
 * than the state the caller asked for. An aspect the pipeline declares no state
 * for gets an inert one: writes off, and a comparison that always passes.
 */
export function depthStencilToGPU(
  desc: PipelineDesc,
): GPUDepthStencilState | undefined {
  const aspects = resolveDepthStencil(desc)
  const format = depthStencilFormatToGPU(aspects)
  if (!format) return undefined
  const state: GPUDepthStencilState = { format }

  if (hasDepthAspect(aspects)) {
    const d = desc.depth
    state.depthWriteEnabled = d ? d.write : false
    state.depthCompare = d
      ? d.test
        ? compareFnToGPU(d.compare ?? 'less-equal')
        : 'always'
      : 'always'
    // Bias belongs to the pipeline that asked for depth. Applying one to an
    // inert aspect would be rejected on a line-list topology.
    if (d) {
      state.depthBias = d.biasConstant ?? 0
      state.depthBiasSlopeScale = d.biasSlopeScale ?? 0
    }
  }

  if (hasStencilAspect(aspects)) {
    const st = desc.stencil
    const front = stencilFaceToGPU(st ? st.front : {})
    state.stencilFront = front
    state.stencilBack = st ? stencilFaceToGPU(st.back ?? st.front) : front
    state.stencilReadMask = st?.readMask ?? 0xff
    // A zero write mask is what makes the inert case inert. A real state keeps
    // the full mask unless it narrowed one itself.
    state.stencilWriteMask = st ? (st.writeMask ?? 0xff) : 0
  }

  return state
}

/** Cull mode → WebGPU cull mode. */
export function cullModeToGPU(c: CullMode): GPUCullMode {
  return c
}

/** Front-face winding → WebGPU front face. */
export function frontFaceToGPU(f: FrontFace): GPUFrontFace {
  return f
}

/** Primitive topology → WebGPU topology. */
export function topologyToGPU(p: PrimitiveTopology): GPUPrimitiveTopology {
  return p === 'line-list' ? 'line-list' : 'triangle-list'
}

/** Index element width → WebGPU index format. */
export function indexTypeToGPU(t: IndexType): GPUIndexFormat {
  return t === 'u32' ? 'uint32' : 'uint16'
}

/** Round a byte size up to a multiple of 4 (WebGPU buffer size requirement). */
export function roundUp4(n: number): number {
  return (n + 3) & ~3
}
