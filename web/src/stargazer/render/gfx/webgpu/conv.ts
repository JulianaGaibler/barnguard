// Enum maps from the backend-neutral `GfxDevice` vocabulary to the WebGPU
// enums. Kept out of `WebGPUDevice` so the device body stays about resource
// lifecycle and pass recording rather than string tables.

import type {
  ColorFormat,
  CompareFn,
  CullMode,
  FrontFace,
  GfxBlendMode,
  IndexType,
  PrimitiveTopology,
  VertexFormat,
} from '../GfxDevice'

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

/** Depth comparison → WebGPU compare function. */
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
  }
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
