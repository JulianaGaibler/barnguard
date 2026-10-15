// Vertex/instance layouts, ring-buffer sizes, and attribute locations shared by
// the GPU draw programs. Kept in one place so a shader's `in` declarations, its
// stride, and its pipeline vertex layout stay in sync.

/**
 * Colored-tri vertex layout: pos.xy (f32) + color.rgba (u8×4) + uv.xy (f32) = 5
 * words = 20 B.
 */
export const COLORED_TRI_STRIDE = 24
export const COLORED_TRI_WORDS = COLORED_TRI_STRIDE / 4
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
 * Round-rect instance layout: affine mCol0.xy + mCol1.xy + mTranslate.xy
 * (f32×6)
 *
 * - (halfW, halfH, feather, strokeWidth) (f32×4) + radii tl,tr,br,bl (f32×4) +
 *   colorFill(u8×4) + colorStroke(u8×4) = 16 words = 64 B. All extents/radii
 *   are in local units. The shader evaluates the signed-distance field in local
 *   space and anti-aliases with `fwidth`, so it stays crisp under any
 *   transform.
 */
export const ROUNDRECT_INSTANCE_STRIDE = 64
/**
 * Gradient-radial instance layout: center.xy + (radius, alpha) + rampRow + pad
 * = 6 words = 24 B. `rampRow` indexes the shared ramp atlas (see
 * `TextureManager.ensureStopsRow`).
 */
export const GRADIENT_INSTANCE_STRIDE = 24

/**
 * Masked-radial-gradient instance layout: dst.xyzw (f32×4) + srcRect.xyzw
 * (f32×4) + grad(centerX, centerY, radius, alpha) (f32×4) + rampRow (f32) = 13
 * words = 52 B. `rampRow` indexes the shared ramp atlas, same as
 * `gradientRadial`.
 */
export const MASKED_GRAD_INSTANCE_STRIDE = 52

/**
 * Text-quad instance layout: mCol0.xy + mCol1.xy + mTranslate.xy (affine,
 * f32×6)
 *
 * - SrcRect.xyzw (f32×4) + tint.rgba (u8×4) = 11 words = 44 B.
 */
export const TEXT_QUAD_INSTANCE_STRIDE = 44

/**
 * Shape-program instance layout: one instanced program covering circles,
 * round-rects, and textured quads (text + atlas sprites). All shapes expand the
 * same unit quad. A per-instance `shapeType` selects the vertex positioning +
 * fragment SDF/texture math. Layout (116 B = 29 words):
 *
 * - MCol0.xy + mCol1.xy + mTranslate.xy, affine (f32×6, offset 0)
 * - Shape = (shapeType, feather, texIndex, pad) (f32×4, offset 24)
 * - Params = shape-specific (f32×4, offset 40): circle `(radius, strokeWidth,
 *   dashStart, dashPeriod)`, roundRect and shadow `(halfW, halfH, strokeWidth,
 *   strokeOffset)`
 * - Radii = round-rect and shadow (tl, tr, br, bl) (f32×4, offset 56)
 * - SrcRect = shape-specific (f32×4, offset 72): textured `(u0, v0, u1, v1)`,
 *   roundRect each corner's smoothing `(tl, tr, br, bl)`, shadow `(sigma,
 *   spread, offsetX, offsetY)`
 * - ColorFill(u8×4, offset 88) + colorStroke(u8×4, offset 92)
 * - Param = index of the primitive's param record (u32, offset 112), see
 *   `ParamTable.ts`
 * - Paint = fill gradient (f32×4, offset 96): `(scaleDirX, scaleDirY,
 *   startOffset, rampRow + 1)`, zero meaning no gradient (a §2.2-zeroed slot is
 *   then safe). A dedicated attribute rather than reusing `a_srcRect`, which a
 *   gradient-tinted textured instance would still need. The fill's opacity
 *   rides in `a_colorFill`'s alpha channel (rgb unused in gradient mode), so no
 *   separate per-instance opacity field is needed. The stroke has no paint
 *   slot: a gradient `strokeCircle`/`strokeRoundRect` flattens to its first
 *   stop (see `GpuGfx.#flattenStrokeColor`).
 */
export const SHAPE_INSTANCE_STRIDE = 116
export const SHAPE_BUFFER_BYTES = 640 * 1024 // 640 KB -> ~5.8k instances
/** Shape `shapeType` discriminants (must match `shape.{vert,frag}.glsl`). */
export const SHAPE_KIND_TEXTURED = 0
export const SHAPE_KIND_CIRCLE = 1
export const SHAPE_KIND_ROUNDRECT = 2
/**
 * An analytic drop shadow (Evan Wallace's erf-based Gaussian integral over a
 * rounded box). Uses the round-rect vertex path: a circle's shadow is a
 * round-rect shadow with uniform radii, same as the fill/stroke kinds treat a
 * circle as a special case of a rounded box.
 */
export const SHAPE_KIND_SHADOW = 3
/**
 * Shape kind for an axis-aligned ellipse in local space, under the full affine
 * like a round rect. Params are `(radiusX, radiusY, strokeWidth,
 * strokeOffset)`.
 */
export const SHAPE_KIND_ELLIPSE = 4
/**
 * Shape `texIndex` values: which fixed-unit texture a textured instance
 * samples.
 */
export const SHAPE_TEX_ATLAS = 0
export const SHAPE_TEX_LABEL = 1

/**
 * Per-stream ring buffer sizes. Sized for peak scenes: the map alone produces
 * ~5k tri verts + ~6.5k stroke instances per frame, then gameplay layers
 * particles / debris / grid overlay on top.
 */
export const COLORED_TRI_BUFFER_BYTES = 2 * 1024 * 1024 // 2 MB -> ~104k verts
export const STROKE_BUFFER_BYTES = 1 * 1024 * 1024 // 1 MB -> ~29k instances
export const SDF_BUFFER_BYTES = 128 * 1024 // 128 KB -> ~4k instances
export const ROUNDRECT_BUFFER_BYTES = 128 * 1024 // 128 KB -> ~2k instances
export const GRADIENT_BUFFER_BYTES = 16 * 1024 // 16 KB  -> ~682 instances
export const MASKED_GRAD_BUFFER_BYTES = 16 * 1024 // 16 KB -> ~340 instances (a few clouds)
export const TEXT_QUAD_BUFFER_BYTES = 128 * 1024 // 128 KB -> ~2.9k label instances

/**
 * Two buffers per stream so the GPU can read buffer N-1 while the CPU writes N.
 * A draw names its buffer per slot, so the WebGL2 backend can cache one VAO per
 * (program, slot) pair.
 */
export const RING_SIZE = 2

/**
 * Uniform-block binding registry. Binding indices are global per device, so
 * every uniform block picks a distinct slot here to keep them from colliding.
 *
 * - 0 `Frame`, the 2D per-frame block (`u_proj`, device-px -> clip).
 * - 1 `Camera3D`, the 3D per-frame view-projection block.
 *
 * Add new blocks (per-material, per-object) at the next free index.
 */
export const FRAME_UBO_BINDING = 0
/** Binding index for the 3D pass's view-projection uniform block. */
export const CAMERA3D_UBO_BINDING = 1
/** `coloredTri` per-run debug/clip params (dynamic-offset ring). */
export const DRAWPARAMS_UBO_BINDING = 2
/**
 * `coloredTri` retained per-draw model matrix, color, and paint (dynamic-offset
 * ring).
 */
export const MODELCOLOR_UBO_BINDING = 3
/** 3D mesh per-frame lights block. */
export const MESH_LIGHTS_UBO_BINDING = 4
/** 3D mesh per-object block (dynamic-offset ring). */
export const MESH_OBJECT_UBO_BINDING = 5
/** Post-process per-pass params block. */
export const POST_PARAMS_UBO_BINDING = 6
/** 3D mesh per-frame shadow block (`u_shadowMat[]` + PCF params). */
export const MESH_SHADOW_UBO_BINDING = 7
/** `shape` per-run debug-mode override (dynamic-offset ring). */
export const SHAPE_PARAMS_UBO_BINDING = 9
/** `shaderQuad` per-draw user params block (dynamic-offset ring). */
export const SHADER_QUAD_PARAMS_UBO_BINDING = 10

/**
 * `Frame` UBO size in floats. std140 lays a `mat3` out as 3 vec4-aligned
 * columns = 12 floats = 48 B, so the 9-float `projMat` is staged with a padding
 * float after each column. Two more floats follow, `targetH` (current
 * render-target height, for the analytic clip's device-px Y) and `fragYFlip` (1
 * on WebGL2, whose `gl_FragCoord.y` is bottom-up), padded out to 16 floats.
 */
export const FRAME_UBO_FLOATS = 16

/**
 * Group-0 binding of the shared per-run analytic clip UBO (2D pipelines only).
 * 8 keeps it clear of the other group-0 bindings the 3D pass uses (Camera3D at
 * 1).
 */
export const CLIP_UBO_BINDING = 8

/**
 * `Clip` UBO size (std140): kind, cx, cy, r, halfW, halfH and two pad floats,
 * then the rounded rect's corner radii as a vec4 = 12 floats = 48 B.
 */
export const CLIP_UBO_BYTES = 48

/**
 * Bind-group group indices. Group 0 is the shared per-frame block (`Frame` /
 * `Camera3D`), reused across every pipeline. Group 1 is per-program resources
 * (textures, per-run/per-object dynamic UBOs). Groups are organizational for
 * WebGPU. The WebGL2 backend flattens to the binding numbers above.
 */
export const GROUP_FRAME = 0
export const GROUP_MATERIAL = 1

/** Attribute locations. Matched to the shaders' `in` declarations. */
export const LOC_COLORED_POS = 0
export const LOC_COLORED_COLOR = 1
export const LOC_COLORED_UV = 2
export const LOC_COLORED_PARAM = 3
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
export const LOC_ROUNDRECT_UNIT = 0
export const LOC_ROUNDRECT_MCOL0 = 1
export const LOC_ROUNDRECT_MCOL1 = 2
export const LOC_ROUNDRECT_TRANSLATE = 3
export const LOC_ROUNDRECT_HALFFEATHER = 4
export const LOC_ROUNDRECT_RADII = 5
export const LOC_ROUNDRECT_COLORFILL = 6
export const LOC_ROUNDRECT_COLORSTROKE = 7
export const LOC_GRAD_UNIT = 0
export const LOC_GRAD_CENTER = 1
export const LOC_GRAD_RADALPHA = 2
export const LOC_GRAD_RAMPROW = 3
export const LOC_MASKGRAD_UNIT = 0
export const LOC_MASKGRAD_DST = 1
export const LOC_MASKGRAD_SRC = 2
export const LOC_MASKGRAD_GRAD = 3
export const LOC_MASKGRAD_RAMPROW = 4
export const LOC_TEXT_UNIT = 0
export const LOC_TEXT_MCOL0 = 1
export const LOC_TEXT_MCOL1 = 2
export const LOC_TEXT_MTRANSLATE = 3
export const LOC_TEXT_SRC = 4
export const LOC_TEXT_TINT = 5
export const LOC_SHAPE_UNIT = 0
export const LOC_SHAPE_MCOL0 = 1
export const LOC_SHAPE_MCOL1 = 2
export const LOC_SHAPE_MTRANSLATE = 3
export const LOC_SHAPE_KIND = 4
export const LOC_SHAPE_PARAMS = 5
export const LOC_SHAPE_RADII = 6
export const LOC_SHAPE_SRCRECT = 7
export const LOC_SHAPE_COLORFILL = 8
export const LOC_SHAPE_COLORSTROKE = 9
export const LOC_SHAPE_PAINT = 10
export const LOC_SHAPE_PARAM = 11

/**
 * Path-shadow composite instance layout: mCol0.xy + mCol1.xy + mTranslate.xy
 * (affine, f32×6) + srcRect.xyzw (f32×4) + tint(u8×4) + dither (f32) = 48 B.
 */
export const PATHSHADOW_INSTANCE_STRIDE = 48
/**
 * Offscreen composite vertex layout: position.xy (device px) + uv = 4 floats =
 * 16 B, six vertices per quad.
 */
export const COMPOSITE_VERTEX_STRIDE = 16
export const COMPOSITE_BUFFER_BYTES = 16 * 1024
export const LOC_COMPOSITE_POS = 0
export const LOC_COMPOSITE_UV = 1

export const PATHSHADOW_BUFFER_BYTES = 16 * 1024 // 16 KB -> ~340 instances
export const LOC_PATHSHADOW_UNIT = 0
export const LOC_PATHSHADOW_MCOL0 = 1
export const LOC_PATHSHADOW_MCOL1 = 2
export const LOC_PATHSHADOW_MTRANSLATE = 3
export const LOC_PATHSHADOW_SRC = 4
export const LOC_PATHSHADOW_TINT = 5
export const LOC_PATHSHADOW_DITHER = 6

/**
 * Shader-quad instance layout: a device-px origin plus the quad's two edge
 * vectors (affine, so rotation and skew survive) and the draw's alpha, as two
 * vec4s = 32 B.
 */
export const SHADER_QUAD_INSTANCE_STRIDE = 32
export const SHADER_QUAD_BUFFER_BYTES = 16 * 1024 // 16 KB -> 512 draws
export const LOC_QUAD_UNIT = 0
export const LOC_QUAD_ORIGIN_AXISX = 1
export const LOC_QUAD_AXISY_ALPHA = 2

/** Pixel tolerance for CPU curve flattening (device px). */
export const CURVE_FLATTEN_TOL_PX = 0.5
/** Max flattened points per curve segment (safety upper bound). */
export const CURVE_FLATTEN_MAX_POINTS = 256

/** The active batch, or `'none'`. A change to the batch key forces a flush. */
export type BatchKind =
  | 'none'
  | 'coloredTri'
  | 'stencilFan'
  | 'stroke'
  | 'gradientRadial'
  | 'maskedGradient'
  | 'textQuad'
  | 'shape'
  | 'pathShadowComposite'
  | 'shaderQuad'
  | 'composite'
