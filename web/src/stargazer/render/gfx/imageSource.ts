// Dimension probes and upload packing for a `TexImageSource`, shared by both
// backends. Every concrete source (ImageBitmap, HTMLCanvasElement, VideoFrame,
// …) carries numeric `width`/`height`, but the union type does not, so read
// them defensively.

import type { TextureUploadOpts } from './GfxDevice'

export function getSourceWidth(source: TexImageSource): number {
  if ('width' in source && typeof source.width === 'number') return source.width
  return 0
}

export function getSourceHeight(source: TexImageSource): number {
  if ('height' in source && typeof source.height === 'number') {
    return source.height
  }
  return 0
}

/**
 * Whether a texture upload flips the source's rows. This is the single source
 * of truth for upload orientation: WebGL2 (`UNPACK_FLIP_Y`) and WebGPU
 * (`copyExternalImageToTexture` and the CPU byte path) all resolve `flipY`
 * through here, so the two backends cannot disagree about which way is up.
 *
 * `flipY` flips the SOURCE rows during the copy; it does not encode screen
 * orientation. Both backends store source row 0 at texel row 0 and sample `uv.y
 * = 0` there, and the shared device-px→clip projection owns the on-screen
 * Y-flip. A source uploaded with the same `flipY` therefore looks identical on
 * both backends, which is why `flipY` must pass through UNCHANGED here.
 *
 * Do not invert this per backend. An earlier WebGPU-only inversion (on the
 * mistaken theory that WebGPU's texture V-origin is opposite) double-flipped
 * every uploaded image, so labels and `drawImage` sources rendered upside down
 * while shapes stayed upright. If an image looks flipped, fix the caller's
 * `flipY` or the shared projection — never this function.
 */
export function resolveUploadFlipY(opts: TextureUploadOpts): boolean {
  return opts.flipY ?? false
}

/**
 * Pack an RGBA image into a fresh byte array for a raw texture write, applying
 * `flipY` (row reversal, via {@link resolveUploadFlipY}) and `premultiply`.
 * These are the two operations WebGPU's `writeTexture` does not do itself
 * (WebGL2 gets them from `pixelStorei`). Pure and DOM-free so the
 * orientation/premultiply contract is unit-testable without a GPU.
 */
export function packUploadRGBA(
  img: { width: number; height: number; data: Uint8ClampedArray },
  opts: TextureUploadOpts,
): Uint8Array<ArrayBuffer> {
  const { width: w, height: h, data } = img
  const flip = resolveUploadFlipY(opts)
  const premul = opts.premultiply ?? false
  const out = new Uint8Array(w * h * 4)
  for (let row = 0; row < h; row++) {
    const srcRow = flip ? h - 1 - row : row
    for (let col = 0; col < w; col++) {
      const si = (srcRow * w + col) * 4
      const di = (row * w + col) * 4
      const a = data[si + 3]
      const s = premul ? a / 255 : 1
      out[di] = Math.round(data[si] * s)
      out[di + 1] = Math.round(data[si + 1] * s)
      out[di + 2] = Math.round(data[si + 2] * s)
      out[di + 3] = a
    }
  }
  return out
}
