// Vertex/instance layouts, ring-buffer sizes, and attribute locations shared by
// the GPU draw programs. Kept in one place so a shader's `in` declarations, its
// stride, and its VAO binding stay in sync.

/**
 * Colored-tri vertex layout: pos.xy (f32) + color.rgba (u8×4) + uv.xy (f32) = 5
 * words = 20 B.
 */
export const COLORED_TRI_STRIDE = 20
export const COLORED_TRI_WORDS = COLORED_TRI_STRIDE / 4
/**
 * Textured-quad instance layout: dst.xyzw (f32) + srcRect.xyzw (f32) +
 * tint.rgba (u8×4) = 9 words = 36 B.
 */
export const TEXTURED_QUAD_INSTANCE_STRIDE = 36
/**
 * Stroke instance layout: p0.xy + p1.xy + color(u8×4) + width + dashStart +
 * dashPeriod + dashOnLen = 9 words = 36 B.
 */
export const STROKE_INSTANCE_STRIDE = 36
/**
 * SDF instance layout: center.xy + (radius, strokeWidth) + colorFill(u8×4) +
 * colorStroke(u8×4) + (dashStart, dashPeriod) = 8 words = 32 B.
 */
export const SDF_INSTANCE_STRIDE = 32
/**
 * Gradient-radial instance layout: center.xy + (radius, alpha) + pad(f32×2) = 6
 * words = 24 B.
 */
export const GRADIENT_INSTANCE_STRIDE = 24

/**
 * Masked-radial-gradient instance layout: dst.xyzw (f32×4) + srcRect.xyzw
 * (f32×4) + grad(centerX, centerY, radius, alpha) (f32×4) = 12 words = 48 B.
 */
export const MASKED_GRAD_INSTANCE_STRIDE = 48

/**
 * Text-quad instance layout: mCol0.xy + mCol1.xy + mTranslate.xy (affine,
 * f32×6)
 *
 * - SrcRect.xyzw (f32×4) + tint.rgba (u8×4) = 11 words = 44 B.
 */
export const TEXT_QUAD_INSTANCE_STRIDE = 44

/**
 * Per-stream ring buffer sizes. Sized for peak scenes: the map alone produces
 * ~5k tri verts + ~6.5k stroke instances per frame, then gameplay layers
 * particles / debris / grid overlay on top.
 */
export const COLORED_TRI_BUFFER_BYTES = 2 * 1024 * 1024 // 2 MB → ~104k verts
export const TEXTURED_QUAD_BUFFER_BYTES = 128 * 1024 // 128 KB → ~3.6k instances
export const STROKE_BUFFER_BYTES = 1 * 1024 * 1024 // 1 MB → ~29k instances
export const SDF_BUFFER_BYTES = 128 * 1024 // 128 KB → ~4k instances
export const GRADIENT_BUFFER_BYTES = 16 * 1024 // 16 KB  → ~682 instances
export const MASKED_GRAD_BUFFER_BYTES = 16 * 1024 // 16 KB → ~340 instances (a few clouds)
export const TEXT_QUAD_BUFFER_BYTES = 128 * 1024 // 128 KB → ~2.9k label instances

/**
 * Two buffers per stream so the GPU can read buffer N-1 while the CPU writes N.
 * VAOs are cached per (program, slot) because a VAO captures the ARRAY_BUFFER
 * bound at `vertexAttribPointer` time.
 */
export const RING_SIZE = 2

/** Attribute locations. Matched to the shaders' `in` declarations. */
export const LOC_COLORED_POS = 0
export const LOC_COLORED_COLOR = 1
export const LOC_COLORED_UV = 2
export const LOC_TEXTURED_UNIT = 0
export const LOC_TEXTURED_DST = 1
export const LOC_TEXTURED_SRC = 2
export const LOC_TEXTURED_TINT = 3
export const LOC_STROKE_UNIT = 0
export const LOC_STROKE_P0 = 1
export const LOC_STROKE_P1 = 2
export const LOC_STROKE_COLOR = 3
export const LOC_STROKE_WIDTHDASH = 4
export const LOC_SDF_UNIT = 0
export const LOC_SDF_CENTER = 1
export const LOC_SDF_RADSTROKE = 2
export const LOC_SDF_COLORFILL = 3
export const LOC_SDF_COLORSTROKE = 4
export const LOC_SDF_DASH = 5
export const LOC_GRAD_UNIT = 0
export const LOC_GRAD_CENTER = 1
export const LOC_GRAD_RADALPHA = 2
export const LOC_MASKGRAD_UNIT = 0
export const LOC_MASKGRAD_DST = 1
export const LOC_MASKGRAD_SRC = 2
export const LOC_MASKGRAD_GRAD = 3
export const LOC_TEXT_UNIT = 0
export const LOC_TEXT_MCOL0 = 1
export const LOC_TEXT_MCOL1 = 2
export const LOC_TEXT_MTRANSLATE = 3
export const LOC_TEXT_SRC = 4
export const LOC_TEXT_TINT = 5

/** Pixel tolerance for CPU curve flattening (device px). */
export const CURVE_FLATTEN_TOL_PX = 0.5
/** Max flattened points per curve segment (safety upper bound). */
export const CURVE_FLATTEN_MAX_POINTS = 256

/** The active batch, or `'none'`. A change to the batch key forces a flush. */
export type BatchKind =
  | 'none'
  | 'coloredTri'
  | 'texturedQuad'
  | 'stroke'
  | 'sdf'
  | 'gradientRadial'
  | 'maskedGradient'
  | 'textQuad'
