/**
 * Build a {@link MaterialTexture} from artwork produced at runtime, so a mesh
 * can be textured without going through a glTF file.
 *
 * @remarks
 *   Pair this with {@link rasterizeSvg} for vector art, or hand it any canvas you
 *   have drawn into. The result is an ordinary material texture: the renderer
 *   dedupes by {@link TextureImage} identity, so share one across every mesh
 *   that draws the same picture rather than building it per node.
 * @example
 *   const face = await createTexture(
 *     await rasterizeSvg(cardSvg, { scale: 2 }),
 *   )
 *   const card = new MeshNode(quad, {
 *     lit: true,
 *     pbr: true,
 *     color: [1, 1, 1, 1],
 *     baseColorTex: face,
 *   })
 */
import type { MaterialTexture, TextureImage } from '../nodes/MeshNode'

/** How the texture is sampled and interpreted. */
export interface CreateTextureOptions {
  /**
   * Whether the pixels are sRGB-encoded color rather than linear data. Default
   * `true`, which is right for base-color and emissive art. Normal,
   * metallic-roughness and occlusion maps are linear and want `false`.
   */
  srgb?: boolean
  /** Default `'clamp'`. */
  wrap?: 'clamp' | 'repeat'
  /**
   * Allocate and sample a mip chain. Default `true`. Leave it on for anything
   * drawn smaller than its source at any point, and turn it off for alpha-MASK
   * albedo, where filtered edges eat the cutout.
   */
  mipmap?: boolean
}

/** A canvas this module can read pixels back out of. */
type SourceCanvas = HTMLCanvasElement | OffscreenCanvas

function descriptor(
  image: TextureImage,
  opts: CreateTextureOptions,
): MaterialTexture {
  return {
    image,
    sampler: { wrap: opts.wrap ?? 'clamp', mipmap: opts.mipmap ?? true },
    srgb: opts.srgb ?? true,
  }
}

/**
 * Re-encode the source so the texture can be rebuilt after a GPU context loss.
 *
 * The renderer closes `bitmap` once it has uploaded and reaches for `bytes` to
 * re-upload later, so a texture with neither comes back blank and stays that
 * way. Encoding is slow relative to the upload, so it runs in the background
 * and the caller never waits on it.
 */
function backfillBytes(image: TextureImage, source: SourceCanvas): void {
  void (async () => {
    try {
      const blob =
        'convertToBlob' in source
          ? await source.convertToBlob({ type: 'image/png' })
          : await new Promise<Blob | null>((resolve) =>
              source.toBlob(resolve, 'image/png'),
            )
      if (blob) image.bytes = new Uint8Array(await blob.arrayBuffer())
    } catch {
      // A texture with no retained bytes still draws. It just cannot come back
      // from a context loss, which is not worth failing construction over.
    }
  })()
}

/**
 * Wrap an already-decoded bitmap. The renderer takes ownership and closes it
 * after upload, so do not use the bitmap afterwards.
 *
 * This form retains no source bytes, so the texture does not survive a GPU
 * context loss. Prefer {@link createTexture} when the art came from a canvas.
 */
export function textureFromImageBitmap(
  bitmap: ImageBitmap,
  opts: CreateTextureOptions = {},
): MaterialTexture {
  return descriptor({ bytes: null, mimeType: 'image/png', bitmap }, opts)
}

/**
 * Build a texture from a canvas or a bitmap.
 *
 * Resolves as soon as the pixels are ready to upload. For a canvas source the
 * PNG re-encode that backs context-loss recovery continues in the background,
 * so the first frame is never waiting on it.
 */
export async function createTexture(
  source: SourceCanvas | ImageBitmap,
  opts: CreateTextureOptions = {},
): Promise<MaterialTexture> {
  if (typeof ImageBitmap !== 'undefined' && source instanceof ImageBitmap) {
    return textureFromImageBitmap(source, opts)
  }
  const canvas = source as SourceCanvas
  const bitmap = await createImageBitmap(canvas, {
    premultiplyAlpha: 'none',
    colorSpaceConversion: 'none',
  })
  const image: TextureImage = { bytes: null, mimeType: 'image/png', bitmap }
  backfillBytes(image, canvas)
  return descriptor(image, opts)
}
